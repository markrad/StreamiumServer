import log4js from 'log4js';
import os from 'os';

import { UdpResponder } from './udpresponder.js';
import { MusicIndex } from './musicindex.js';

let logger = log4js.getLogger('UDPServer');
logger.level = 'debug';

type UpdServerOptions = {
    musicIndex: MusicIndex
    port: number,
    webPort: number,
    streamiumId: StreamiumId
}

export type StreamiumId = {
    version: string,
    vendor: string,
    name: string,
    shortName: string,
}

type IpInfo = {
    ip: string,
    broadcast: string
}

export class UdpServer {
    private _options: UpdServerOptions;
    private _servers: UdpResponder[];

    constructor(options: UpdServerOptions) {
        this._options = options;
    }

    public async start(): Promise<void> {
        logger.info('Starting UDP Server');
        this._servers = UdpServer._getIPs().map((ipInfo: IpInfo) => { 
            return new UdpResponder({ 
                musicIndex: this._options.musicIndex,
                ipAddress: ipInfo.ip, 
                broadcastAddress: ipInfo.broadcast,
                streamiumId: this._options.streamiumId,
                webPort: this._options.webPort,
                port: this._options.port });
        });
        logger.info(`Listening on ${this._servers.map((entry) => entry.ip).join(', ')}`);
    }

    public async stop(): Promise<void> {
        logger.info('Stopping UDP Server');
        for (let server of this._servers) {
            await server.close();
        }
    }

    private static _getIPs(): IpInfo[] {
        let ifaces = os.networkInterfaces();
        let r = [];

        for (const name of Object.keys(ifaces)) {
            for (const net of ifaces[name]) {
                // Skip over non-IPv4 and internal (i.e. 127.0.0.1) addresses
                // 'IPv4' is in Node <= 17, from 18 it's a number 4 or 6
                const familyV4Value = typeof net.family === 'string' ? 'IPv4' : 4
                if (net.family === familyV4Value && !net.internal) {
                    r.push({ ip: net.address, broadcast: UdpServer._getBroadcastAddress(net.address, net.netmask) });
                }
            }
        }
        return r;
    }
    
    private static _getBroadcastAddress(address: string, netmask: string): string {
        const addressBytes = address.split(".").map(Number);
        const netmaskBytes = netmask.split(".").map(Number);
        const subnetBytes = netmaskBytes.map(
            (_, index) => addressBytes[index] & netmaskBytes[index]
        );
        const broadcastBytes = netmaskBytes.map(
            (_, index) => subnetBytes[index] | (~netmaskBytes[index] + 256)
        );
        return broadcastBytes.map(String).join(".")
    }
}
