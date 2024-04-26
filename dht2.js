import { noise } from '@chainsafe/libp2p-noise'
import { yamux } from '@chainsafe/libp2p-yamux'
import { bootstrap } from '@libp2p/bootstrap'
import { identify } from '@libp2p/identify'
import { kadDHT } from '@libp2p/kad-dht'
import { mplex } from '@libp2p/mplex'
import { tcp } from '@libp2p/tcp'
import { createLibp2p } from 'libp2p'
import { mdns } from '@libp2p/mdns'
import readline from 'readline'
import axios from 'axios'


let ip_response = await axios.get('https://api.ipify.org?format=json')
const PORT = 5556;                                          // CHANGE PORT HERE
const PUBLIC_IP = ip_response.data.ip;
import { CID } from 'multiformats/cid'
import { sha256 } from 'multiformats/hashes/sha2'
import * as json from 'multiformats/codecs/json'

const node = await createLibp2p({
    addresses: {
        listen: [`/ip4/0.0.0.0/tcp/${PORT}`],
        announce: [`/ip4/${PUBLIC_IP}/tcp/${PORT}`]         // COMMENT OUT TO MAKE CLIENT, UNCOMMENT TO MAKE SERVER
    },
    transports: [tcp()],
    streamMuxers: [yamux(), mplex()],
    connectionEncryption: [noise()],
    peerDiscovery: [
        bootstrap({
          list: ['/ip4/72.229.181.210/tcp/5555/p2p/12D3KooWFQ8XWQPfjVUPFkvkLY6R8snUQDgFshV1Fvobq7qHk88W']
        }),
        mdns()
    ],
    services: {
        kadDHT: kadDHT({
            kBucketSize: 20,
            enabled: true,
            randomWalk: {
                enabled: true,            // Allows to disable discovery (enabled by default)
                interval: 300e3,
                timeout: 10e3
            }
        }),
        identify: identify()
    }
})

node.addEventListener('peer:connect', (evt) => {
    const peerId = evt.detail
    console.log('Connection established to:', peerId.toString()) // Emitted when a peer has been found
})

node.addEventListener('peer:discovery', (evt) => {
    const peerInfo = evt.detail

    console.log('Discovered:', peerInfo.id.toString())
})


async function putKeyValue(node, key, value) {
    const keyUint8Array = new Uint8Array(Buffer.from(key));
    const valueUint8Array = new Uint8Array(Buffer.from(value));
    try {
        let retrievedValue = node.services.kadDHT.put(keyUint8Array, valueUint8Array);
        for await (const queryEvent of retrievedValue) {
            console.log('dht:put', queryEvent)
        }
    } catch (err) {
        throw err;
    }
}

async function getValue(node, key) {
    const keyUint8Array = new Uint8Array(Buffer.from(key));
    for await (const queryEvent of node.services.kadDHT.get(keyUint8Array)) {
        if (queryEvent.hasOwnProperty('name') &&  queryEvent['name'] == 'VALUE') {
            const value = queryEvent['value'].toString();
            console.log('value:', value)
        }
        console.log('dht:get', queryEvent)
    }
}

async function provide(node, key) {
    const bytes = json.encode({key: key}); 
    const hash = await sha256.digest(bytes);
    const cid = CID.create(1, json.code, hash); 
    for await (const queryEvent of node.services.kadDHT.provide(cid)) {
        console.log('dht:provide', queryEvent)
    }
}

async function getProviders(node, key) {
    const bytes = json.encode({key: key}); 
    const hash = await sha256.digest(bytes);
    const cid = CID.create(1, json.code, hash); 
    for await (const queryEvent of node.services.kadDHT.findProviders(cid)) {
        console.log('dht:getProviders', queryEvent)
    }
}

async function cli(node) {
    const rl = readline.createInterface({
        input: process.stdin,
        output: process.stdout
    });

    rl.setPrompt('> ');

    rl.prompt();

    rl.on('line', async (input) => {
        const [command, ...args] = input.trim().split(' ');
        switch (command) {
            case 'put':
                if (args.length !== 2) {
                    console.error('Usage: put <key> <value>');
                    break;
                }
                await putKeyValue(node, args[0], args[1]);
                await node.services.kadDHT.refreshRoutingTable()
                break;
            case 'get':
                if (args.length !== 1) {
                    console.error('Usage: get <key>');
                    break;
                }
                await node.services.kadDHT.refreshRoutingTable();
                await getValue(node, args[0]);
                break;
            case 'provide':
                if (args.length !== 1) {
                    console.error('Usage: provide <key>');
                    break;
                }
                await provide(node, args[0]);
                break;
            case 'getProviders':
                if (args.length !== 1) {
                    console.error('Usage: get <key>');
                    break;
                }
                await node.services.kadDHT.refreshRoutingTable();
                await getProviders(node, args[0]);
                break;
            case 'get_mode':
                if (args.length !== 0) {
                    console.error('Usage: get_mode');
                    break;
                }
                console.log(node.services.kadDHT.getMode());
                break;
            case 'set_mode':
                if (args.length !== 1) {
                    console.error('Usage: set_mode <client/server>');
                    break;
                }
                await node.services.kadDHT.setMode(args[0]);
                break;
            default:
                console.error('Unknown command:', command);
                break;
        }
        rl.prompt();
    });

    process.on('SIGTERM', () => {
        rl.close();
        node.stop();
    });

    process.on('SIGINT', () => {
        rl.close();
        node.stop();
    });
    rl.on('close', () => {
        console.log('Exiting...');
        process.exit(0);
    });
}

console.log(node.peerId)
node.getMultiaddrs().forEach((multi) => console.log(multi))
node.services.kadDHT.contentFetching.log.enabled = true;
cli(node)