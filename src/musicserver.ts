import Express, { /*Application,*/ NextFunction, Request, Response,  /*Router, application*/ } from 'express';
import { XMLParser } from 'fast-xml-parser';

import log4js from 'log4js';
import { MusicIndex, NodeInfo, AlbumSet, TrackSet, ArtistSet } from './musicindex.js';
import { NodeType } from './types/NodeType.js';
import { IGenreEntry } from './database/IGenreEntry.js';
import { IArtistEntry } from './database/IArtistEntry.js';
import { IAlbumEntry } from './database/IAlbumEntry.js';
import { IMusicEntry } from './database/IMusicEntry.js';
import http from 'http';
import path from 'node:path';
import { IArtistAllTracksEntry } from './database/IArtistAllTracksEntry.js';
import { IIndexEntry } from './database/IIndexEntry.js';

const LISTENER_PORT = 42951;

const logger = log4js.getLogger('MusicServer');
logger.level = 'debug';

// type streamiumNode = {
//     name: string,
//     nodeid: number,
// }

// type tempNode = {
    
// }

const TOP_NODE = 0;
const ARTISTS_NODE = 1;
const ALBUMS_NODE = 2;
const GENRES_NODE = 3;

export class MusicServer {
    private _app: Express.Application = Express();
    private _xmlParser = new XMLParser();
    private _musicIndex: MusicIndex;
    private _server: http.Server;
    private _root: string;

    constructor(index: MusicIndex) {
        this._musicIndex = index;
        this._root = index.root;
    }

    async start(): Promise<void> {
        logger.info('Starting MusicServer');

        this._app.use((req: Request, _res: Response, next: NextFunction) => {
            if (req.method === 'GET') {
                logger.info(`GET request for ${decodeURIComponent(req.url)}`);
            }
            next();
        });

        let dir: string;
        if (process.versions.bun) {
            dir = path.join(__dirname, '../web/');
        }
        else {
            dir = path.join(__dirname, '../../web/views');
        }

        logger.debug(`Setting views directory to ${path.join(dir, 'views')}`);
        this._app.set('views', `${path.join(dir, 'views')}`);
        this._app.set('view engine', 'pug');
        this._app.use(Express.static(this._root));
        this._app.use(Express.static(`${path.join(dir, 'scripts')}`));
        this._app.use(Express.static(`${path.join(dir, 'styles')}`));

        this._app.use(Express.raw({ type: (req) => {
            logger.trace(`Static request for ${req.url}`);
            return req.url === '//';
        }}));

        this._app.get('/', (_req: Request, res: Response) => {
            res.render('index');
        });

        this._app.post('//', (req: Request, res: Response, _next: NextFunction) => {
            logger.trace(req.body.toString());
            try {
                let input: string = req.body.toString();
                input = input.substring(input.indexOf('<requestnavdata>'));
                let xml = this._xmlParser.parse(input);
                let navdata = xml.requestnavdata;
                logger.debug(`Client request: nodeid ${navdata.nodeid? navdata.nodeid: 'initial'} for ${navdata.numelem} elements from index ${navdata.fromindex? navdata.fromindex: 0} with superscroll ${navdata.superscroll? 'enabled': 'disabled'}`);
                logger.trace(xml);
                let xmlRes: string;
                if (!navdata.nodeid) {
                    xmlRes = this._returnTopLevelNodes();
                    logger.debug('Sending initial response');
                }
                else {
                    let fromIndex: number = navdata.fromindex? navdata.fromindex: 0;

                    switch (navdata.nodeid) {
                        case ARTISTS_NODE:
                            let artists: ArtistSet = this._musicIndex.getArtists(req.ip, fromIndex, navdata.numelem, navdata.superscroll);
                            xmlRes = this._buildListResponse(artists.nodes, fromIndex, artists.totalCount);
                            logger.debug(`Sending ${artists.nodes.length} artist${artists.nodes.length == 1? '': 's'}`);
                            break;
                        case ALBUMS_NODE:
                            let albums: AlbumSet = this._musicIndex.getAlbums(req.ip, fromIndex, navdata.numelem, navdata.superscroll);
                            xmlRes = this._buildListResponse(albums.nodes, fromIndex, albums.totalCount);
                            logger.debug(`Sending ${albums.nodes.length} album${albums.nodes.length == 1? '': 's'}`);
                            break;
                        case GENRES_NODE:
                            let genres = this._musicIndex.getGenres(req.ip, fromIndex, navdata.numelem, navdata.superscroll);
                            xmlRes = this._buildListResponse(genres.nodes, fromIndex, genres.totalCount);
                            logger.debug(`Sending ${genres.nodes.length} genre${genres.nodes.length == 1? '': 's'}`);
                            break;
                        default:
                            let nodeInfo: NodeInfo = this._musicIndex.getNodeType(navdata.nodeid);
                            if (nodeInfo == null) { 
                                logger.error(`Unknown nodeid: ${navdata.nodeid}`);
                                res.status(500).send('Unknown nodeid');
                                return;
                            }
                            let url = `${req.protocol}://${req.hostname}:${LISTENER_PORT}/`;
                            switch (nodeInfo.type) {
                                case NodeType.artist:
                                    let albumSet: AlbumSet = this._musicIndex.getAlbumsByArtist(nodeInfo.nodeRow as IArtistEntry, fromIndex, navdata.numelem);
                                    xmlRes = this._buildListResponse(albumSet.nodes, fromIndex, albumSet.totalCount);
                                    logger.debug(`Sending ${albumSet.nodes.length} album${albumSet.nodes.length == 1? '': 's'} from: ${fromIndex}; count: ${navdata.numelem} of: ${albumSet.totalCount}`);
                                    break;
                                case NodeType.album:
                                    let trackSet: TrackSet = this._musicIndex.getTracksByAlbum(nodeInfo.nodeRow as IAlbumEntry, fromIndex, navdata.numelem);
                                    xmlRes = this._buildTrackListResponse(trackSet.tracks, fromIndex, trackSet.totalCount, url);
                                    logger.debug(`Sending ${trackSet.tracks.length} track${trackSet.tracks.length == 1 ? '' : 's'} from: ${fromIndex}; count: ${navdata.numelem} of: ${trackSet.totalCount}`);
                                    break;
                                case NodeType.artistAllTracks:
                                    // let artistAllTracks: IArtistAllTracksEntry = nodeInfo.nodeRow as IArtistAllTracksEntry;
                                    let allTracks: TrackSet = this._musicIndex.getAllTracksByArtist(req.ip, nodeInfo.nodeRow as IArtistAllTracksEntry, fromIndex, navdata.numelem, navdata.superscroll);
                                    xmlRes = this._buildTrackListResponse(allTracks.tracks, fromIndex, allTracks.totalCount, url);
                                    logger.debug(`Sending ${allTracks.tracks.length} track${allTracks.tracks.length == 1 ? '' : 's'} from: ${fromIndex}; count: ${navdata.numelem} of: ${allTracks.totalCount}`);
                                    break;
                                case NodeType.genre:
                                    let genreSet = this._musicIndex.getTracksByGenre(req.ip, nodeInfo.nodeRow as IGenreEntry, fromIndex, navdata.numelem, navdata.superscroll);
                                    xmlRes = this._buildTrackListResponse(genreSet.tracks, fromIndex, genreSet.totalCount, url);
                                    logger.debug(`Sending ${genreSet.tracks.length} genre${genreSet.tracks.length == 1? '': 's'} from: ${fromIndex}; count: ${navdata.numelem} of: ${genreSet.totalCount}`);
                                    break;
                                case NodeType.track:
                                    let track: IMusicEntry = this._musicIndex.getTrack(nodeInfo.nodeId);
                                    xmlRes = this._buildTrackListResponse([track], fromIndex, 1, `${req.protocol}://${req.hostname}:${LISTENER_PORT}/`);
                                    logger.debug(`Sending track: ${track.name}`);
                                    break;
                                default:
                                    logger.error(`Unknown node type: ${nodeInfo.type}`);
                                    res.status(500).send('Unknown node type');
                                    return;
                            }
                    }
                }

                logger.trace(xmlRes);
                res.status(200).send(xmlRes);
            }
            catch (err) {
                logger.error(err);
                res.status(500).send(`Error: ${err}`);
            }
        });

        this._app.get('/node', (req: Request, res: Response) => {
            let nodeId = parseInt(req.query.nodeid as string, 10);
            switch (nodeId) {
                case TOP_NODE:
                    res.json(this._xmlParser.parse(this._returnTopLevelNodes()));
                    break;
                case ARTISTS_NODE:
                    let artists = this._musicIndex.artists.sort((a, b) => a.name.localeCompare(b.name));
                    res.json(this._xmlParser.parse(this._buildListResponse(artists, 0, artists.length)));
                    break;
                case ALBUMS_NODE:
                    let albums = this._musicIndex.albums.sort((a, b) => a.name.localeCompare(b.name));
                    res.json(this._xmlParser.parse(this._buildListResponse(albums, 0, albums.length)));
                    break;
                case GENRES_NODE:
                    let genres = this._musicIndex.genres.sort((a, b) => a.name.localeCompare(b.name));
                    res.json(this._xmlParser.parse(this._buildListResponse(genres, 0, genres.length)));
                    break;
                default:
                    let nodeInfo = this._musicIndex.getNodeType(nodeId);
                    if (nodeInfo == null) {
                        logger.error(`Unknown nodeid: ${nodeId}`);
                        res.status(500).send('Unknown nodeid');
                        return;
                    }
                    let url = `${req.protocol}://${req.hostname}:${LISTENER_PORT}/`;
                    switch (nodeInfo.type) {
                        case NodeType.artist:
                            let albumSet = this._musicIndex.getAlbumsByArtist(nodeInfo.nodeRow as IArtistEntry, 0, (nodeInfo.nodeRow as IArtistEntry).albums.length + 1);
                            res.json(this._xmlParser.parse(this._buildListResponse(albumSet.nodes, 0, albumSet.totalCount)));
                            break;
                        case NodeType.album:
                            let trackSet = this._musicIndex.getTracksByAlbum(nodeInfo.nodeRow as IAlbumEntry, 0, (nodeInfo.nodeRow as IAlbumEntry).tracks.length);
                            res.json(this._xmlParser.parse(this._buildTrackListResponse(trackSet.tracks, 0, trackSet.totalCount, url)));
                            break;
                        case NodeType.genre:
                            let genreSet = this._musicIndex.getTracksByGenre(req.ip, nodeInfo.nodeRow as IGenreEntry, 0, (nodeInfo.nodeRow as IGenreEntry).tracks.length, '');
                            res.json(this._xmlParser.parse(this._buildTrackListResponse(genreSet.tracks, 0, genreSet.totalCount, url)));
                            break;
                        case NodeType.track:
                            let track = this._musicIndex.getTrack(nodeId);
                            res.json(this._xmlParser.parse(this._buildTrackListResponse([track], 0, 1, `${req.protocol}://${req.hostname}:${LISTENER_PORT}/`)));
                            break;
                        default:
                            logger.error(`Unknown node type: ${nodeInfo.type}`);
                            res.status(500).send('Unknown node type');
                            return;
                    }
                }
        });
        
        this._app.get('/node/:nodeId', (req: Request, res: Response) => {
            const nodeId = parseInt(req.params.nodeId, 10);

            if (nodeId === 0) {
                // res.set('Content-Type', 'application/xml');
                res.type('xml');    
                res.send(this._returnTopLevelNodes());
                // res.json(this._xmlParser.parse(this._returnTopLevelNodes()));
                return;
            }
            const nodeInfo = this._musicIndex.getNodeType(nodeId);
            if (nodeInfo == null) {
                logger.error(`Unknown nodeid: ${nodeId}`);
                res.status(500).send('Unknown nodeid');
                return;
            }

            switch (nodeInfo.type) {
                case NodeType.artist:
                    res.render('artist', { artist: nodeInfo.nodeRow as IArtistEntry });
                    break;
                case NodeType.album:
                    res.render('album', { album: nodeInfo.nodeRow as IAlbumEntry });
                    break;
                case NodeType.genre:
                    res.render('genre', { genre: nodeInfo.nodeRow as IGenreEntry });
                    break;
                case NodeType.track:
                    res.render('track', { track: nodeInfo.nodeRow as IMusicEntry });
                    break;
                default:
                    logger.error(`Unknown node type: ${nodeInfo.type}`);
                    res.status(500).send('Unknown node type');
                    return;
            }
        });

        this._app.get('/ping', (_req: Request, res: Response) => {
            res.send('pong');
        });

        this._app.get('/artists', async (_req: Request, res: Response) => {
            try {
                const artists = this._musicIndex.artists.sort((a, b) => a.name.localeCompare(b.name));
                let html = '<html><head><title>Artists</title></head><body><h1>Artists</h1>';
                html += '<a href="/albums">Go to Albums</a> | <a href="/genres">Go to Genres</a> | <a href="/tracks">Go to Tracks</a><ul>';
                for (const artist of artists) {
                    html += `<li><a href="/artists/${artist.nodeId}/albums">${artist.name}</a></li>`;
                }
                html += '</ul></body></html>';
                res.send(html);
            } catch (err) {
                logger.error(err);
                res.status(500).send(`Error: ${err}`);
            }
        });

        this._app.get('/artists/:artistId/albums', async (req: Request, res: Response) => {
            try {
                const artistId = parseInt(req.params.artistId, 10);
                const artist = this._musicIndex.getNodeType(artistId).nodeRow as IArtistEntry;
                const albums = this._musicIndex.getAlbumsByArtist(artist, 0, artist.albums.length + 1).nodes;
                let html = `<html><head><title>Albums by ${artist.name}</title></head><body><h1>Albums by ${artist.name}</h1>`;
                html += '<a href="/artists">Go to Artists</a><ul>';
                for (const album of albums) {
                    html += `<li><a href="/albums/${album.nodeId}/tracks">${album.name}</a></li>`;
                }
                html += '</ul></body></html>';
                res.send(html);
            } catch (err) {
                logger.error(err);
                res.status(500).send(`Error: ${err}`);
            }
        });

        this._app.get('/albums', async (_req: Request, res: Response) => {
            try {
                const albums = this._musicIndex.albums.sort((a, b) => a.name.localeCompare(b.name));
                let html = '<html><head><title>Albums</title></head><body><h1>Albums</h1>';
                html += '<a href="/artists">Go to Artists</a> | <a href="/genres">Go to Genres</a> | <a href="/tracks">Go to Tracks</a><ul>';
                for (const album of albums) {
                    html += `<li><a href="/albums/${album.nodeId}/tracks">${album.name}</a></li>`;
                }
                html += '</ul></body></html>';
                res.send(html);
            } catch (err) {
                logger.error(err);
                res.status(500).send(`Error: ${err}`);
            }
        });

        this._app.get('/albums/:albumId/tracks', async (req: Request, res: Response) => {
            try {
                const albumId = parseInt(req.params.albumId, 10);
                const album = this._musicIndex.getNodeType(albumId).nodeRow as IAlbumEntry;
                const tracks = this._musicIndex.getTracksByAlbum(album, 0, album.tracks.length).tracks;
                let html = `<html><head><title>Tracks in ${album.name}</title></head><body><h1>Tracks in ${album.name}</h1>`;
                html += '<a href="/albums">Go to Albums</a><table><thead><tr><th>Artist</th><th>Album</th><th>Track</th></tr></thead><tbody>';
                for (const track of tracks) {
                    const trackUrl = `${req.protocol}://${req.hostname}:${LISTENER_PORT}/${encodeURIComponent(path.relative(this._root, track.file))}`;
                    html += `<tr><td>${track.artist}</td><td>${track.album}</td><td><a href="${trackUrl}">${track.name}</a></td></tr>`;
                }
                html += '</tbody></table></body></html>';
                res.send(html);
            } catch (err) {
                logger.error(err);
                res.status(500).send(`Error: ${err}`);
            }
        });

        this._app.get('/genres', async (_req: Request, res: Response) => {
            try {
                const genres = this._musicIndex.genres.sort((a, b) => a.name.localeCompare(b.name));
                let html = '<html><head><title>Genres</title></head><body><h1>Genres</h1>';
                html += '<a href="/artists">Go to Artists</a> | <a href="/albums">Go to Albums</a> | <a href="/tracks">Go to Tracks</a><ul>';
                for (const genre of genres) {
                    html += `<li><a href="/genres/${genre.nodeId}/tracks">${genre.name}</a></li>`;
                }
                html += '</ul></body></html>';
                res.send(html);
            } catch (err) {
                logger.error(err);
                res.status(500).send(`Error: ${err}`);
            }
        });

        this._app.get('/genres/:genreId/tracks', async (req: Request, res: Response) => {
            try {
                const genreId = parseInt(req.params.genreId, 10);
                const genre = this._musicIndex.getNodeType(genreId).nodeRow as IGenreEntry;
                const tracks = this._musicIndex.getTracksByGenre(req.ip, genre, 0, genre.tracks.length, '').tracks;
                let html = `<html><head><title>Tracks in ${genre.name}</title></head><body><h1>Tracks in ${genre.name}</h1>`;
                html += '<a href="/genres">Go to Genres</a><table><thead><tr><th>Artist</th><th>Album</th><th>Track</th></tr></thead><tbody>';
                for (const track of tracks) {
                    const trackUrl = `${req.protocol}://${req.hostname}:${LISTENER_PORT}/${encodeURIComponent(path.relative(this._root, track.file))}`;
                    html += `<tr><td>${track.artist}</td><td>${track.album}</td><td><a href="${trackUrl}">${track.name}</a></td></tr>`;
                }
                html += '</tbody></table></body></html>';
                res.send(html);
            } catch (err) {
                logger.error(err);
                res.status(500).send(`Error: ${err}`);
            }
        });

        this._app.get('/tracks', async (_req: Request, res: Response) => {
            try {
                const tracks = this._musicIndex.tracks.sort((a, b) => a.name.localeCompare(b.name));
                let html = '<html><head><title>Tracks</title></head><body><h1>Tracks</h1>';
                html += '<a href="/artists">Go to Artists</a> | <a href="/albums">Go to Albums</a> | <a href="/genres">Go to Genres</a><table><thead><tr><th>Artist</th><th>Album</th><th>Track</th></tr></thead><tbody>';
                for (const track of tracks) {
                    const trackUrl = `${_req.protocol}://${_req.hostname}:${LISTENER_PORT}/${encodeURIComponent(path.relative(this._root, track.file))}`;
                    html += `<tr><td>${track.artist}</td><td>${track.album}</td><td><a href="${trackUrl}">${track.name}</a></td></tr>`;
                }
                html += '</tbody></table></body></html>';
                res.send(html);
            } catch (err) {
                logger.error(err);
                res.status(500).send(`Error: ${err}`);
            }
        });

        this._server = this._app.listen(LISTENER_PORT, () => {
            logger.info(`Listening on port ${LISTENER_PORT}`);
        });
    }

    async stop(): Promise<void> {
        return new Promise<void>((resolve, reject) => {
            logger.info('Stopping Music Server');
            this._server.close((err) => {
                if (err) {
                    reject(err);
                }
                else {
                    logger.info('Stopped Music Server');    
                    resolve();
                }
            });
        });
    }

    private _returnTopLevelNodes(): string {
        let response: IIndexEntry[] = [
            {
                name: 'Artist',
                nodeId: ARTISTS_NODE,
            },
            {
                name: 'Album',
                nodeId: ALBUMS_NODE,
            },
            {
                name: 'Genre',
                nodeId: GENRES_NODE,
            },
        ];
        return this._buildInitialResponse(0, response.length, false, response);
    }


    private _buildInitialResponse(fromIndex: number, totalNodes: number, alphanumeric: boolean, nodes: IIndexEntry[]): string {
        let body: string = '';

        for (let node of nodes) {
            body += `<contentdata><name>${node.name}</name><nodeid>${node.nodeId}</nodeid><branch/></contentdata>`;
        }

        let auxData: string = `<totnumelem>${totalNodes}</totnumelem><fromindex>${fromIndex}</fromindex><numelem>${nodes.length}</numelem>${alphanumeric? '<alphanumeric/>': ''}`;

        body = `<contentdataset>${body}${auxData}</contentdataset>`;

        return body;
    }

    private _buildListResponse(nodes: IArtistEntry[] | IAlbumEntry[] | IGenreEntry[] | IMusicEntry[], fromIndex: number, totalNodes: number): string {
        let xml = '';
        logger.debug(`From index ${fromIndex} to ${fromIndex + nodes.length - 1} of ${totalNodes}`);
        logger.debug(`From node ${nodes[0].name} to node ${nodes[nodes.length - 1].name}`);

        for (let node of nodes) {
            xml += `<contentdata><name>${node.name}</name><nodeid>${node.nodeId}</nodeid><branch/></contentdata>`;
        }

        xml = `${xml}<totnumelem>${totalNodes}</totnumelem><fromindex>${fromIndex}</fromindex><numelem>${nodes.length}</numelem><alphanumeric/>`;
        xml = `<contentdataset>${xml}</contentdataset>`;

        return xml;
    }

    private _buildTrackListResponse(tracks: IMusicEntry[], fromIndex: number, totalNodes: number, urlPrefix: string): string {
        let xml = '';

        for (let track of tracks) {
            let location = path.relative(this._root, track.file);
            xml += `\
<contentdata>\
<name>${track.name}</name>\
<nodeid>${track.nodeId}</nodeid>\
<playable/>\
<url>${urlPrefix}${encodeURIComponent(location)}</url>\
<title>${track.track} ${track.name}</title>\
<album>${track.album}</album>\
<trackno>${track.track}</trackno>\
<artist>${track.artist}</artist>\
<genre>${track.genre.join(',')}</genre>\
<year>${track.year}</year>\
<bitrate></bitrate>\
<playlength>${Math.floor(track.duration)}</playlength>\
</contentdata>`;
        }

        xml = `${xml}<totnumelem>${tracks.length}</totnumelem><fromindex>${fromIndex}</fromindex><numelem>${totalNodes}</numelem><alphanumeric/>`;
        xml = `<contentdataset>${xml}</contentdataset>`;

        return xml;
    }
}