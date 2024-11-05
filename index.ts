
import { MusicIndex } from './src/musicindex.js';
import log4js from 'log4js';
import os from 'os';
import { UdpServer, StreamiumId } from './src/udpserver.js';
import { MusicServer } from './src/musicserver.js';

const logger = log4js.getLogger('Main');

logger.level = 'debug';

const STREAMIUM_ID: StreamiumId = { 
    version: '1.0', 
    vendor: 'MUSICMATCH', 
    name: 'local-' + os.hostname(), 
    shortName: os.hostname() };
const SERVER_PORT = 42591;
const WEB_PORT = 42951;


(async function name() {
    logger.info('Starting test');
    let index: MusicIndex = null;
    let UDPServer: UdpServer = null;
    let webServer: MusicServer = null;
    try {
        process.on('SIGINT', async () => {
            if (index) {
                await index.stop();
            }
            if (UDPServer) {
                await UDPServer.stop();
            }
            if (webServer) {
                await webServer.stop();
            }
            logger.info('Exiting');
            process.exit(0);
        });
        index = new MusicIndex({ musicRoot: process.argv[2], databaseFile: './music.db' });
        const start = performance.now();
        await index.start();
        const end = performance.now();
        logger.debug(`Time to index files: ${makeTime(end - start)}`);
        webServer = new MusicServer(index);
        await webServer.start();
        UDPServer = new UdpServer({ 
            musicIndex: index,
            port: SERVER_PORT, 
            webPort: WEB_PORT,
            streamiumId: STREAMIUM_ID });
        await UDPServer.start();
    } catch (err) {
        console.error(err);
    }
})();

function makeTime(millis: number) {
    let work = Math.floor(millis / 1000); 
    let seconds = work % 60;
    work = Math.floor(work / 60);
    let minutes = work % 60;
    work = Math.floor(work / 60);
    let hours = work % 24;
    work = Math.floor(work / 24);
    let days = work;
    return `${days > 0 ? days + 'd ' : ''}${hours > 0 ? hours + 'h ' : ''}${minutes > 0 ? minutes + 'm ' : ''}${seconds}s`;
}