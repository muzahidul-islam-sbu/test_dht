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

const node = await createLibp2p({
    addresses: {
        listen: ['/ip4/0.0.0.0/tcp/0'],
        // announce: ['/ip4/72.229.181.210/tcp/0']
    },
    transports: [tcp()],
    streamMuxers: [yamux(), mplex()],
    connectionEncryption: [noise()],
    peerDiscovery: [
        // bootstrap({
        //   list: bootstrappers
        // }),
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
    for await (const queryEvent of node.services.kadDHT.getClosestPeers(keyUint8Array)) {
        console.log('dht:peerRouting', queryEvent)
    }
    for await (const queryEvent of node.services.kadDHT.get(keyUint8Array)) {
        console.log('dht:get', queryEvent)
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
node.services.kadDHT.contentFetching.log.enabled = true;
cli(node)