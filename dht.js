import { createLibp2p } from 'libp2p'
import { tcp } from '@libp2p/tcp'
import { mdns } from '@libp2p/mdns'
import { noise } from '@chainsafe/libp2p-noise'
import { kadDHT, removePrivateAddressesMapper, EventTypes, removePublicAddressesMapper } from '@libp2p/kad-dht'
import { yamux } from '@chainsafe/libp2p-yamux'
import { bootstrap } from '@libp2p/bootstrap'

async function createNode(port) {
    const node = await createLibp2p({
        addresses: {
            listen: ['/ip4/0.0.0.0/tcp/0'],
            announce: [`/ip4/127.0.0.1/tcp/${port}`]
        },
        transports: [tcp()],
        streamMuxers: [yamux()],
        connectionEncryption: [noise()],
        services: {
            dht: kadDHT({
                kBucketSize: 20,
                allowQueryWithZeroPeers: false,
                querySelfInterval: 10,
                peerInfoMapper: removePublicAddressesMapper,
                protocol: '/ipfs/lan/kad/1.0.0',
                clientMode: false
            })
        },
        peerDiscovery: [
            mdns(),
            // bootstrap({
            //     list: [
            //         // bootstrap node here is generated from dig command                    
            //         // '/dnsaddr/sg1.bootstrap.libp2p.io/p2p/QmcZf59bWwK5XFi76CZX8cbJ4BhTzzA3gU1ZjYZcYW3dwt',
            //         '/ip4/127.0.0.1/tcp/53528/p2p/12D3KooWBjWDPwMH7qkejjZWD6LjNM2HTyZ78zTvF3Gwt14oLBJA'
            //     ]
            // })
        ]
    });

    return node;
}

import readline from 'readline'
import { getPackedSettings } from 'http2'
async function init(port) {
    const node = await createNode(port);

    // Log peer events
    node.addEventListener('peer', (connection) => {
        console.log('\n\n\nTHERE WAS A PEER EVENT\n\n\n' + connection);
    });

    const discoveredPeerIds = []
    // Log peer discovery events
    node.addEventListener('peer:discovery', (connection) => {
        console.log('Discovered peer:', connection.detail.id, connection.detail.multiaddrs);
        discoveredPeerIds.push(connection.detail.id)
    });

    // Log peer connection events
    node.addEventListener('peer:connect', async (connection) => {
        console.log(node.peerId, 'Connected to peer:', connection.detail);

        let retrievedValue = node.services.dht.findPeer(connection.detail);
        for await (const queryEvent of retrievedValue) {
            console.log('dht:connect', queryEvent)
        }

        // await node.dial(connection.detail);
    });

    node.addEventListener(EventTypes.VALUE, () => {
        console.log('found')
    })

    console.log('PeerID', node.peerId.toString());
    node.getMultiaddrs().forEach((addr) => {
        console.log(addr.toString());
    });

    // Start the DHT
    node.services.dht.log.enabled = true;
    node.services.dht.contentFetching.log.enabled = true;
    node.services.dht.peerRouting.log.enabled = true;
    node.services.dht.network.log.enabled = true;
    node.services.dht.topologyListener.log.enabled = true;

    await node.services.dht.start();
    await node.services.dht.setMode('server');
    await node.start();

    return node;
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
                await node.services.dht.refreshRoutingTable();
                break;
            case 'get':
                if (args.length !== 1) {
                    console.error('Usage: get <key>');
                    break;
                }
                await node.services.dht.refreshRoutingTable();
                await getValue(node, args[0]);
                break;
            case 'get_mode':
                if (args.length !== 0) {
                    console.error('Usage: get_mode');
                    break;
                }
                console.log(node.services.dht.getMode());
                break;
            case 'set_mode':
                if (args.length !== 1) {
                    console.error('Usage: set_mode <client/server>');
                    break;
                }
                await node.services.dht.setMode(args[0]);
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
    // node.services.dht.put(a, b, {useNetwork: true, useCache: false})
    rl.on('close', () => {
        console.log('Exiting...');
        process.exit(0);
    });
}

async function putKeyValue(node, key, value) {
    const keyUint8Array = new TextEncoder('utf8').encode(key);
    const valueUint8Array = new TextEncoder('utf8').encode(value);
    try {
        console.log("trying put keyvalue...");
        let retrievedValue = node.services.dht.put(keyUint8Array, valueUint8Array, { useNetwork: true, useCache: false });
        for await (const queryEvent of retrievedValue) {
            console.log('dht:put', queryEvent)
        }
        await node.services.dht.refreshRoutingTable();
    } catch (err) {
        throw err;
    }
}

async function getValue(node, key) {
    console.log("trying get value...");
    await node.services.dht.refreshRoutingTable();
    const keyUint8Array = new TextEncoder('utf8').encode(key);
    let retrievedValue;
    retrievedValue = node.services.dht.getClosestPeers(keyUint8Array)
    for await (const queryEvent of retrievedValue) {
        console.log('dht:peerRouting', queryEvent)
    }
    retrievedValue = node.services.dht.get(keyUint8Array, { useNetwork: true, useCache: false });
    for await (const queryEvent of retrievedValue) {
        console.log('dht:get', queryEvent)
    }
}

// import { createHash } from 'crypto';
// const hash = createHash('sha256').update('test').digest()
// const hashk = '/pk/' + hash;

// const k = 'test';
// const k = 'test';
// const v = 'a';
// let node = await init(600);
// let node2 = await init(700);
// await new Promise(r => setTimeout(r, 1000));
// await node.services.dht.refreshRoutingTable();
// await node2.services.dht.refreshRoutingTable();
// await new Promise(r => setTimeout(r, 1000));
// console.log(node.services.dht.routingTable.kb.root);
// console.log(node2.services.dht.routingTable.kb.root);
// console.log(node.services.dht.routingTable.size);
// console.log(node2.services.dht.routingTable.size);
// await putKeyValue(node, k, v);
// await getValue(node, k);
// await getValue(node2, k);

let node = await init(process.argv[2]);
await cli(node);