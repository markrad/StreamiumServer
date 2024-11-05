import { IIndexEntry } from "./IIndexEntry.js";

export interface IAlbumEntry extends IIndexEntry {
    artist: string;
    tracks: number[];
}
