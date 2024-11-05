import { IIndexEntry } from "./IIndexEntry.js";

export interface IArtistEntry extends IIndexEntry {
    albums: number[];
    allTracks: number;
}
