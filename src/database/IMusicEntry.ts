import { IIndexEntry } from "./IIndexEntry.js";

export interface IMusicEntry extends IIndexEntry {
    file: string;
    artist: string;
    album: string;
    track: number;
    year: number;
    genre: string[];
    duration: number;
}
