import * as dgram from 'dgram';
import * as net from 'net';
import { StreamiumId } from './udpserver.js';

import log4js from 'log4js';

import { udpPacketDecoder } from './udppacketdecoder.js';
import { MusicIndex } from './musicindex.js';

let logger = log4js.getLogger('UDPResponder');
logger.level = 'debug';

const SUPPORTED_VERSION = '1.0';
const SUPPORTED_VENDOR_ID = 'Philips';
const SUPPORTED_NAME = 'MC-i200';

type UdpResponderOptions = {
    musicIndex: MusicIndex
    ipAddress: string,
    broadcastAddress: string,
    streamiumId: StreamiumId,
    port: number,
    webPort: number,
}

export class UdpResponder {
    private _options: UdpResponderOptions;
    private _ipAddressConverted: number;
    private _webPortConverted: number;
    private _server: dgram.Socket;

    constructor(options: UdpResponderOptions) {
        this._options = options;
        this._ipAddressConverted = UdpResponder._convertIp(options.ipAddress);
        this._webPortConverted = UdpResponder._convertPort(options.webPort);
        this._server = dgram.createSocket('udp4');
        this._server.on('message', this._messageHandler.bind(this));
        this._server.on('message', (msg, rinfo) => logger.debug(`Message from ${rinfo.address}:${rinfo.port} - ${msg}`));
        this._server.on('error', (err) => logger.error(`UDP Error: ${err}`));
        this._server.on('listening', () => {
            const address = this._server.address();
            logger.info(`UDP responder listening on ${address.address}:${address.port}`);
        });
        this._server.bind({ port: this._options.port, address: this._options.broadcastAddress });
    }

    async close(): Promise<void> {
        return new Promise<void>((resolve, _reject) => {
            this._server.removeAllListeners();
            this._server.close(() => {
                logger.info(`UDP responder closed on ${this._options.ipAddress}:${this._options.port}`);
                resolve();
            });
        });
    }

    get ip(): string { return this._options.ipAddress; }

    private _messageHandler(msg: Buffer, rinfo: dgram.RemoteInfo): void {
        try {
            logger.debug(`Message from ${rinfo.address}:${rinfo.port} - ${msg}`);
            let decoder = new udpPacketDecoder(msg.toString());
            logger.trace(`Version: ${decoder.version}`);
            logger.trace(`Name: ${decoder.name}`);
            logger.trace(`Vendor ID: ${decoder.vendorId}`);
            logger.trace(`IP: ${decoder.ip}`);
            logger.trace(`Port: ${decoder.port}`);
            if (!(decoder.version === SUPPORTED_VERSION && decoder.vendorId === SUPPORTED_VENDOR_ID && decoder.name === SUPPORTED_NAME)) {
                logger.warn(`Packet may not be supported`);
            }

            logger.debug(`Connecting to Streamium at ${decoder.ip}:${decoder.port}`);
            let client = net.createConnection(decoder.port, decoder.ip, () => {
                logger.info(`Connected to ${decoder.ip}:${decoder.port}`);
                let packet = this._makePacket();
                logger.debug(`Sending packet: ${packet}`);
                client.write(packet);
                this._options.musicIndex.clearSuperScroll(`::ffff:${decoder.ip}`);
            });
            client.on('error', (err) => logger.error(`Failed to send packet to Streamium: ${err}`));
            client.on('end', () => logger.debug('Streamium disconnected'));
        } catch (e) {
            logger.error(`Error processing packet: ${e}`);
        }
    }

    private _makePacket(): string {
        return  '<PCLinkServer>' + 
                    `<Version>${this._options.streamiumId.version}</Version>` + 
                    `<VendorID>${this._options.streamiumId.vendor}</VendorID>` + 
                    `<name>${this._options.streamiumId.name}</name>` +
                    `<ShortName>${this._options.streamiumId.shortName}</ShortName>` + 
                    `<IP>${this._ipAddressConverted}</IP>` +
                    `<Port>${this._webPortConverted}</Port>` +
                '</PCLinkServer>';
    }

    private static _convertIp(ip: string): number {
        let bits = ip.split('.').map(bit => parseInt(bit));
        let result = 0;
        for (let i = 0; i < bits.length; i++) {
            result += (bits[i] << (i * 8)) >>> 0;
        }
        return result;
    }

    private static _convertPort(port: number): number {
        return ((port & 0xFF) << 8) | ((port >> 8) & 0xFF);
    }
}
