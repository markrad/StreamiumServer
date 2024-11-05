import log4js from 'log4js';

const logger = log4js.getLogger('MusicIndex');
logger.level = "debug";

export class udpPacketDecoder {
    private _version: string;
    private _name: string;
    private _vendorId: string;
    private _ip: string;
    private _port: number;

    constructor(packet: string) {
        packet = packet.replace(/[\n]/g, '');
        if (/^<PCLinkClient>[\s,\S]*<\/PCLinkClient>$/.test(packet)) {
            this._version = packet.match(/<Version>(.*)<\/Version>/)[1];
            this._name = packet.match(/<Name>(.*)<\/Name>/)[1];
            this._vendorId = packet.match(/<VendorID>(.*)<\/VendorID>/)[1];
            this._ip = udpPacketDecoder._parseIp(parseInt(packet.match(/<IP>(.*)<\/IP>/)[1]));
            this._port = udpPacketDecoder._parsePort(parseInt(packet.match(/<Port>(.*)<\/Port>/)[1]));
        }
        else {
            throw new Error('Invalid packet');
        }
    }

    public get version(): string { return this._version; }
    public get name(): string { return this._name; }
    public get vendorId(): string { return this._vendorId; }
    public get ip(): string { return this._ip; }
    public get port(): number { return this._port; }

    private static _parseIp(ip: number): string {
        return `${ip & 0xFF}.${ip >> 8 & 0xFF}.${ip >> 16 & 0xFF}.${ip >> 24 & 0xFF}`;
    }

    private static _parsePort(port: number): number {
        return ((port & 0xFF) << 8) | ((port >> 8) & 0xFF);
    }
}
