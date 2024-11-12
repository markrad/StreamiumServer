import { readdir } from 'node:fs/promises';
import * as path from 'node:path';
import { parseFile } from 'music-metadata';
import { IAudioMetadata } from '../node_modules/music-metadata/lib/type.js';
import { PromisePool } from '@supercharge/promise-pool';
import loki from 'lokijs';
const { LokiFsAdapter } = loki;
import { EventWaiter } from './utilities/eventwaiter.js';
import log4js from 'log4js';
import { IDbMetadataRow } from './database/IDbMetadataRow.js';
import { IMusicEntry } from './database/IMusicEntry.js';
import { IAlbumEntry } from './database/IAlbumEntry.js';
import { IArtistEntry } from './database/IArtistEntry.js';
import { IGenreEntry } from './database/IGenreEntry.js';
import { NodeType } from './types/NodeType.js';
import { IArtistAllTracksEntry } from './database/IArtistAllTracksEntry.js';
import { IArtistByLetterEntry } from './database/IArtistByLetterEntry.js';
import { Config } from '../index.js';

type MusicIndexOptions = {
    config: Config;
    databaseFile: string;
}

export type ArtistSet = {
    totalCount: number;
    nodes: IArtistEntry[];
}

export type TrackSet = { 
    totalCount: number;
    tracks: IMusicEntry[] 
}

export type AlbumSet = {
    totalCount: number;
    nodes: IAlbumEntry[];
}

export type GenreSet = {
    totalCount: number;
    nodes: IGenreEntry[];
}

export type NodeInfo = {
    nodeId: number;
    type: NodeType;
    nodeRow: IArtistEntry | IArtistAllTracksEntry | IAlbumEntry | IGenreEntry | IMusicEntry;
}

enum TagsMissing {
    none = 0,
    artist = 1,
    album = 2,
    title = 4,
    track = 8
}

type SuperScrollInfo = {
    remoteAddress: string;
    artists: Resultset<IArtistEntry & LokiObj>;
    albums: Resultset<IAlbumEntry & LokiObj>;
    genres: Resultset<IGenreEntry & LokiObj>;
    artistByLetter: Resultset<IArtistByLetterEntry & LokiObj>;
    artistAllTracks: Resultset<IMusicEntry & LokiObj>;
    tracks: Resultset<IMusicEntry & LokiObj>;
}

const logger = log4js.getLogger('MusicIndex');
logger.level = "debug";

const FIRST_NODE = 100;

export class MusicIndex {
    // private _root: string;
    private _dbFile: string;
    private readonly _currentDbVersion: number = 1;
    private _db: Loki;
    private _dbMetadata: Collection<IDbMetadataRow>;
    private _musicFiles: Collection<IMusicEntry>;
    private _artists: Collection<IArtistEntry>;
    private _artistAllTracks: Collection<IArtistAllTracksEntry>;
    private _artistByLetter: Collection<IArtistByLetterEntry>;
    private _albums: Collection<IAlbumEntry>;
    private _genres: Collection<IGenreEntry>;
    private _nextNode: number;
    private _superScroll: Map<string, SuperScrollInfo> = new Map();
    private _config: Config

    constructor(options: MusicIndexOptions) {
        this._config = options.config;
        this._dbFile = options.databaseFile;
    }

    public async start(): Promise<void> {
        logger.info(`Starting music index`);
        var ew = new EventWaiter();
        let getCollections: () => void = () => {
            if (null == (this._dbMetadata = this._db.getCollection('dbMetadata'))) {
                this._dbMetadata = this._db.addCollection<IDbMetadataRow>('dbMetadata', {});
                this._dbMetadata.insert({ version: this._currentDbVersion, nextNode: FIRST_NODE });
            }
            if (null == (this._musicFiles = this._db.getCollection<IMusicEntry>('musicFiles'))) {
                this._musicFiles = this._db.addCollection<IMusicEntry>('musicFiles', { indices: [ 'nodeId' ] });
            }
            if (null == (this._artists = this._db.getCollection<IArtistEntry>('artists'))) {
                this._artists = this._db.addCollection<IArtistEntry>('artists', { indices: ['nodeId'] });
            }
            if (null == (this._albums = this._db.getCollection<IAlbumEntry>('albums'))) {
                this._albums = this._db.addCollection<IAlbumEntry>('albums', { indices: ['nodeId'] });
            }
            if (null == (this._genres = this._db.getCollection<IGenreEntry>('genres'))) {
                this._genres = this._db.addCollection<IGenreEntry>('genres', { indices: ['nodeId'] });
            }
            if (null == (this._artistAllTracks = this._db.getCollection<IArtistAllTracksEntry>('artistAllTracks'))) {
                this._artistAllTracks = this._db.addCollection<IArtistAllTracksEntry>('artistAllTracks', { indices: ['nodeId'] });
            }
            if (null == (this._artistByLetter = this._db.getCollection<IArtistByLetterEntry>('artistByLetter'))) {
                this._artistByLetter = this._db.addCollection<IArtistByLetterEntry>('artistByLetter', { indices: ['nodeId'] });
            }
            
            this._nextNode = this._dbMetadata.findOne({ version: this._currentDbVersion }).nextNode;

            ew.EventSet();
        }
        this._db = new loki(path.join(this._dbFile), {
            autosave: true,
            autosaveInterval: 2000,
            adapter: new LokiFsAdapter(),
            autoload: true,
            autoloadCallback: getCollections,
            verbose: true,
            persistenceMethod: 'fs'
        });

        await ew.EventWait();

        logger.info('Finding music files');
        let files = (await this._indexDir(this._config.musicRoot)).sort((l, r) => l.localeCompare(r));
        logger.info(`Found ${files.length} file${files.length == 1 ? '' : 's'}`);
        let removedEntries = 0;
        for (let entry of this._musicFiles.find()) {
            let index = this._binarySearch(files, entry.file);
            if (index === -1) {
                this._musicFiles.remove(entry);
                logger.warn(`Removed ${entry.file} - file not found`);
                removedEntries++;
            }
            else {
                files.splice(index, 1);
            }
        }

        if (removedEntries > 0) logger.warn(`Removed ${removedEntries} row${removedEntries == 1 ? '' : 's'} from the index`);

        if (files.length > 0) {
            await this._insertTracks(files);
            this._dbMetadata.findAndUpdate({ version: this._currentDbVersion }, (entry) => {
                entry.nextNode = this._nextNode;
            });
        }
        else {
            logger.info('No new files to index');
        }

        let musicFilesCount = this._musicFiles.count();
        let pad = musicFilesCount.toString().length;
        logger.info(`Indexed ${this.totalTracks} track${this.totalTracks == 1 ? '' : 's'}`);
        logger.info(`        ${this.totalArtists.toString().padStart(pad)} artist${this.totalArtists == 1 ? '' : 's'}`);
        logger.info(`        ${this.totalAlbums.toString().padStart(pad) } album${this.totalAlbums == 1 ? '' : 's'}`);
        logger.info(`        ${this.totalGenres.toString().padStart(pad) } genre${this.totalGenres == 1 ? '' : 's'}`);


    }

    public async stop(): Promise<void> {
        this._db.saveDatabase();
        this._db.close();
        logger.info('Music index stopped');
    }

    public get root(): string { return this._config.musicRoot; }
    public get nextNode(): number { return this._nextNode; }
    public get artists(): IArtistEntry[] { return this._artists.chain().find().simplesort('name').data(); }
    public get albums(): IAlbumEntry[] { return this._albums.chain().find().simplesort('name').data(); }
    public get genres(): IGenreEntry[] { return this._genres.chain().find().simplesort('name').data(); }
    public get tracks(): IMusicEntry[] { return this._musicFiles.chain().find().simplesort('name').data(); }
    public get totalArtists(): number { return this.artists.length; }
    public get totalAlbums(): number { return this.albums.length; }
    public get totalGenres(): number { return this.genres.length; }
    public get totalTracks(): number { return this.tracks.length; }

    public getNodeType(nodeId: number): NodeInfo {
        let row: IArtistEntry | IArtistAllTracksEntry | IAlbumEntry | IGenreEntry | IMusicEntry;
        if (row = this._artists.findOne({ nodeId: nodeId })) return { nodeId: nodeId, nodeRow: row, type: NodeType.artist };
        else if (row = this._artistAllTracks.findOne({ nodeId: nodeId })) return { nodeId: nodeId, nodeRow: row, type: NodeType.artistAllTracks };
        else if (row = this._albums.findOne({ nodeId: nodeId })) return { nodeId: nodeId, nodeRow: row, type: NodeType.album };
        else if (row = this._genres.findOne({ nodeId: nodeId })) return { nodeId: nodeId, nodeRow: row, type: NodeType.genre };
        else if (row = this._musicFiles.findOne({ nodeId: nodeId })) return { nodeId: nodeId, nodeRow: row, type: NodeType.track };
        else return null;
    }

    public getArtists(remoteAddress: string, fromIndex: number, count: number, superscroll: string = null): ArtistSet {
        let client = this._getClient(remoteAddress);
        if (superscroll) {
            this.clearSuperScroll(remoteAddress);
            client.artists = this._artists.chain().find({ name: { $regex: new RegExp(`^${superscroll}`, 'i') } }).sort((l, r) => l.name.toLowerCase().localeCompare(r.name.toLowerCase()));
        }

        return client.artists
            ? { totalCount: client.artists.count(), nodes: client.artists.offset(fromIndex).limit(count).data() }
            : { totalCount: this.totalArtists, nodes: this._artists.chain().find().sort((l, r) => l.name.toLowerCase().localeCompare(r.name.toLowerCase())).offset(fromIndex).limit(count).data() };
    }

    public getAlbums(remoteAddress: string, fromIndex: number, count: number, superscroll: string = null): AlbumSet {
        let client = this._getClient(remoteAddress);
        if (superscroll) {
            this.clearSuperScroll(remoteAddress);
            client.albums = this._albums.chain().find({ name: { $regex: new RegExp(`^${superscroll}`, 'i') } }).sort((l, r) => l.name.toLowerCase().localeCompare(r.name.toLowerCase()));
        }

        return client.albums
            ? { totalCount: client.albums.count(), nodes: client.albums.offset(fromIndex).limit(count).data() }
            : { totalCount: this.totalAlbums, nodes: this._albums.chain().find().sort((l, r) => l.name.toLowerCase().localeCompare(r.name.toLowerCase())).offset(fromIndex).limit(count).data() };
    }

    public getAllTracksByArtist(remoteAddress: string, artist: IArtistAllTracksEntry, fromIndex: number, count: number, superscroll: string = null): TrackSet {
        let client = this._getClient(remoteAddress);
        if (superscroll) {
            this.clearSuperScroll(remoteAddress);
            client.artistAllTracks = this._musicFiles.chain().find({ $and: [{ $loki: { $in: artist.tracks }}, { name: { $regex: new RegExp(`^${superscroll}`, 'i') } }] }).sort((l, r) => {
                let res = l.name.toLowerCase().localeCompare(r.name.toLowerCase());
                return res === 0? l.track - r.track : res;
            });
        }

        return client.artistAllTracks
            ? { totalCount: client.artistAllTracks.count(), tracks: client.artistAllTracks.offset(fromIndex).limit(count).data() }
            : { totalCount: artist.tracks.length, tracks: this._musicFiles.chain().find({ $loki: { $in: artist.tracks } }).compoundsort([['album', false], ['track', false]]).offset(fromIndex).limit(count).data() };
        
        // let trackList = this._musicFiles.chain().find({ $loki: { $in: artist.tracks } }).compoundsort([['album', false], ['track', false]]);
        // let totalCount = trackList.count();
        // let tracks = trackList.offset(fromIndex).limit(count).data();
        // return { totalCount: totalCount, tracks: tracks };
    }

    public getGenres(remoteAddress: string, fromIndex: number, count: number, superscroll: string = null): GenreSet {
        let client = this._getClient(remoteAddress);
        if (superscroll) {
            this.clearSuperScroll(remoteAddress);
            client.genres = this._genres.chain().find({ name: { $regex: new RegExp(`^${superscroll}`, 'i') } }).sort((l, r) => l.name.toLowerCase().localeCompare(r.name.toLowerCase()));
        }

        return client.genres
            ? { totalCount: client.genres.count(), nodes: client.genres.offset(fromIndex).limit(count).data() }
            : { totalCount: this.totalGenres, nodes: this._genres.chain().find().sort((l, r) => l.name.toLowerCase().localeCompare(r.name.toLowerCase())).offset(fromIndex).limit(count).data() };

        // return this._genres.chain().find().simplesort('name').offset(fromIndex).limit(count).data();
    }

    public getTracksByAlbum(album: IAlbumEntry, fromIndex: number, count: number): TrackSet {
        let trackList = this._musicFiles.chain().find({ $loki: { $in: album.tracks } }).simplesort('track');
        let totalCount = trackList.count();
        let tracks = trackList.offset(fromIndex).limit(count).data();
        return { totalCount: totalCount, tracks: tracks };
    }

    public getTracksByGenre(remoteAddress: string, genre: IGenreEntry, fromIndex: number, count: number, superscroll: string = null): TrackSet {
        let client = this._getClient(remoteAddress);
        if (superscroll) {
            this.clearSuperScroll(remoteAddress);
            client.tracks = this._musicFiles.chain().find({ $and: [{ $loki: { $in: genre.tracks }}, { name: { $regex: new RegExp(`^${superscroll}`, 'i') } }] }).simplesort('name');
        }
        return client.genres
            ? { totalCount: client.tracks.count(), tracks: client.tracks.offset(fromIndex).limit(count).data() }
            : { 
                totalCount: genre.tracks.length,
                tracks: this._musicFiles.chain()
                    .find({ $loki: { $in: genre.tracks } })
                    .simplesort('name').offset(fromIndex).limit(count)
                    .data() 
            };
    }

    public getAlbumsByArtist(artistRow: IArtistEntry, fromIndex: number, count: number): AlbumSet {
        let albumList: IAlbumEntry[] = [];
        if (fromIndex == 0) {
            let allTracks = this._artistAllTracks.findOne({ $loki: artistRow.allTracks });
            albumList.push({ name: 'All Tracks', artist: artistRow.name, nodeId: allTracks.nodeId, tracks: allTracks.tracks });
        }
        let work = this._albums.chain().find({ $loki: { $in: artistRow.albums } }).offset(fromIndex).limit(count - albumList.length).simplesort('name');
        logger.debug(`Found ${work.count()} album${work.count() == 1 ? '' : 's'} for artist ${artistRow.name}`);
        albumList = albumList.concat(work.offset(fromIndex).limit(count - albumList.length).data());
        return { totalCount: albumList.length, nodes: albumList };
    }

    public getTrack(nodeId: number): IMusicEntry {
        return this._musicFiles.findOne({ nodeId: nodeId });
    }

    public clearSuperScroll(remoteAddress: string): void {
        this._superScroll.delete(remoteAddress);
    }

    private _getClient(remoteAddress: string): SuperScrollInfo {
        let client = this._superScroll.get(remoteAddress);
        if (!client) {
            client = {
                remoteAddress: remoteAddress,
                artists: null,
                albums: null,
                genres: null,
                artistByLetter: null,
                artistAllTracks: null,
                tracks: null
            };
            this._superScroll.set(remoteAddress, client);
        }
        return client;
    }

    private async _insertTracks(files: string[]): Promise<void> {
        logger.info(`Indexing ${files.length} file${files.length == 1 ? '' : 's'}`);
        if (files.length > 1000) {
            logger.warn('Indexing a large number of files may take a while');
        }
        let onePercent = Math.round(files.length / 100);
        let indexedFiles = 0;
        let droppedFiles = 0;
        await PromisePool
            .withConcurrency(500)
            .for(files)
            .process(async (file) => {
                let fileMetadata = await this._indexFile(file);
                if (fileMetadata == null) {
                    droppedFiles++;
                }
                else {
                    this._musicFiles.insert(this._createMusicEntry(file, fileMetadata));
                }
                if (files.length > 1000 && ++indexedFiles % onePercent === 0) {
                    logger.info(`Indexed ${Math.round(indexedFiles / files.length * 100)}% of files`);
                }
            });
        logger.info(`Dropped ${droppedFiles} file${droppedFiles == 1 ? '' : 's'} due to missing tags`);
        logger.info(`Indexed ${indexedFiles} file${indexedFiles == 1 ? '' : 's'}`);
        logger.info('Indexing genres, artists, and albums');
        
        let musicFiles = this._musicFiles.find();

        for (let row of musicFiles) {
            for (let genre of row.genre) {
                let genreEntry = this._genres.findOne({ name: genre });
                if (!genreEntry) {
                    this._genres.insert({ name: genre, nodeId: this._nextNode++, tracks: [ row.$loki] });
                }
                else if (!genreEntry.tracks.includes(row.$loki)) {
                    genreEntry.tracks.push(row.$loki);
                    this._genres.update(genreEntry);
                }
            }
            let albumEntry = this._albums.findOne({ name: row.album, artist: row.artist });
            if (!albumEntry) {
                this._albums.insert({ name: row.album, artist: row.artist, nodeId: this._nextNode++, tracks: [ row.$loki ] });
            }
            else if (!albumEntry.tracks.includes(row.$loki)) {
                albumEntry.tracks.push(row.$loki);
                this._albums.update(albumEntry);
            }

            let artistByLetterEntry = this._artistByLetter.findOne({ name: row.artist[0].toUpperCase() });
            if (!artistByLetterEntry) {
                this._artistByLetter.insert({ name: row.artist[0].toUpperCase(), nodeId: this._nextNode++, artists: [ row.$loki ] });
            }
            else if (!artistByLetterEntry.artists.includes(row.$loki)) {
                artistByLetterEntry.artists.push(row.$loki);
                this._artistByLetter.update(artistByLetterEntry);
            }
        }

        for (let row of this._albums.find()) {
            let artistEntry = this._artists.findOne({ name: row.artist });
            if (!artistEntry) {
                let allTracks = (this._artistAllTracks.insert({ name: row.artist, nodeId: this._nextNode++, tracks: row.tracks })) as IArtistAllTracksEntry & LokiObj;
                this._artists.insert({ name: row.artist, nodeId: this._nextNode++, albums: [ row.$loki ], allTracks: allTracks.$loki });
            }
            else if (!artistEntry.albums.includes(row.$loki)) {
                artistEntry.albums.push(row.$loki);
                this._artists.update(artistEntry);
                this._artistAllTracks.findAndUpdate({ $loki: artistEntry.allTracks }, (entry) => {
                    entry.tracks = entry.tracks.concat(row.tracks);
                });
            }
        }
        logger.info('Indexing complete');
    }

    private _createMusicEntry(file: string, metadata: IAudioMetadata): IMusicEntry {
        return {
            file: file,
            artist: metadata.common.artist,
            album: metadata.common.album,
            name: metadata.common.title,
            track: metadata.common.track.no,
            year: metadata.common.year,
            genre: metadata.common.genre? metadata.common.genre : [],
            duration: metadata.format.duration,
            nodeId: this._nextNode++,
        };
    }

    private async _indexDir(dir: string): Promise<string[]> {
        return new Promise<string[]>(async (resolve, reject) => {
            try {
                let dirs: Promise<string[]>[] = [];
                const files = await readdir(dir, { withFileTypes: true });
                let mp3s = files.filter(file => file.isFile() && path.extname(file.name) === '.mp3').map((file) => {
                    return path.join(dir, file.name);
                });

                for (let dirEnt of files.filter(file => file.isDirectory())) {
                    dirs.push(this._indexDir(path.join(dir, dirEnt.name)));
                }
                let results = await Promise.all(dirs);
                for (let result of results) {
                    mp3s = mp3s.concat(result);
                }
                resolve(mp3s);
            }
            catch (err) {
                reject(err);
            }
        });
    }

    private async _indexFile(file: string): Promise<IAudioMetadata> {
        return new Promise<IAudioMetadata>(async (resolve, reject) => {
            try {
                const metadata = await parseFile(file);
                let good: TagsMissing = TagsMissing.none;
                if (!metadata.common.artist) {
                    good |= TagsMissing.artist;
                }
                if (!metadata.common.album) {
                    good |= TagsMissing.album;
                }
                if (!metadata.common.title) {
                    good |= TagsMissing.title;
                }
                if (!metadata.common.track.no) {
                    good |= TagsMissing.track;
                }
                if (good !== TagsMissing.none) {
                    let msg: string[] = [];
                    if (good & TagsMissing.artist) msg.push('artist');
                    if (good & TagsMissing.album) msg.push('album');
                    if (good & TagsMissing.title) msg.push('title');
                    if (good & TagsMissing.track) msg.push('track');
                    logger.warn(`File: ${file} dropped - missing tag${msg.length > 1? 's' : ''} ${msg.join(', ')}`);
                }

                resolve(good === TagsMissing.none? metadata : null);
            }
            catch (err) {
                reject(err);
            }
        });
    }

    private _binarySearch(files: string[], target: string): number {
        let left = 0;
        let right = files.length - 1;
        while (left <= right) {
            let mid = Math.floor((left + right) / 2);
            switch (files[mid].localeCompare(target)) {
                case 0:
                    return mid;
                case -1:
                    left = mid + 1;
                    break;
                case 1:
                    right = mid - 1;
                    break;
            }
        }
        return -1;
    }
}