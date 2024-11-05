import { IIndexEntry } from "./IIndexEntry.js";

export interface IArtistAllTracksEntry extends IIndexEntry {
    tracks: number[];
}