import { createLibp2p } from 'libp2p'
import { tcp } from '@libp2p/tcp'
import { mdns } from '@libp2p/mdns'
import { noise } from '@chainsafe/libp2p-noise'
import { kadDHT, removePrivateAddressesMapper, EventTypes, removePublicAddressesMapper } from '@libp2p/kad-dht'
import { yamux } from '@chainsafe/libp2p-yamux'
import { bootstrap } from '@libp2p/bootstrap'
import { multiaddr } from '@multiformats/multiaddr'
import { pipe } from 'it-pipe'
import { fromString as uint8ArrayFromString } from 'uint8arrays/from-string'
import { toString as uint8ArrayToString } from 'uint8arrays/to-string'
import * as lp from 'it-length-prefixed'
import map from 'it-map'

async function createNode() {
    const node = await createLibp2p({
        addresses: {
            listen: ['/ip4/0.0.0.0/tcp/0']
        },
        transports: [tcp()],
        streamMuxers: [yamux()],
        connectionEncryption: [noise()],
        services: {
            dht: kadDHT({
            })
        },
        peerDiscovery: [
            mdns(),
            // bootstrap({
            //      list: [
            //          // bootstrap node here is generated from dig command                    
            //         //  '/dnsaddr/sg1.bootstrap.libp2p.io/p2p/QmcZf59bWwK5XFi76CZX8cbJ4BhTzzA3gU1ZjYZcYW3dwt',
            //         //  '/ip4/52.191.209.254/tcp/64928/p2p/12D3KooWQ4drrqNFJth3k4g8RV3dSQiu7LdEjKg467xaCfK5578N'
            //      ]
            // })
        ]
    });

    return node;
}

import readline from 'readline'
async function main() {
    const node = await createNode();
    const discoveredPeers = []
    // Log peer discovery events
    // node.addEventListener('peer:discovery', async (connection) => {
    //     console.log('Discovered peer:', connection.detail.id, connection.detail.multiaddrs);
    // });

    // // Log peer connection events
    // node.addEventListener('peer:connect', async (connection) => {
    //     console.log('Connected to peer:', connection, connection.detail, connection.detail.multiaddrs);
    // });


    console.log('PeerID', node.peerId.toString());
    node.getMultiaddrs().forEach((addr) => {
        console.log(addr.toString());
    });

    // Start the DHT
    await node.services.dht.setMode('server');
    await node.services.dht.start();
    await node.start();

    const data = {
        multi: node.getMultiaddrs()[0].toString(),
        http: 'http addr',
        grpc: 'grpc addr'
    }

    await node.handle('/example/protocol', async ({stream}) => {
        let withBootstrap = JSON.parse(JSON.stringify(discoveredPeers));
        withBootstrap.push(data)
        console.log(JSON.stringify(withBootstrap))
        pipe(
            [JSON.stringify(withBootstrap)],
            // Turn strings into buffers
            (source) => map(source, (string) => uint8ArrayFromString(string)),
            // Encode with length prefix (so receiving side knows how much data is coming)
            (source) => lp.encode(source),
            stream.sink
        )
        pipe(
            stream.source,
            // Decode length-prefixed data
            (source) => lp.decode(source),
            // Turn buffers into strings
            (source) => map(source, (buf) => uint8ArrayToString(buf.subarray())),
            async function (source) {
                for await (var message of source) {
                    discoveredPeers.push(JSON.parse(message))
                    console.log('Discovered:', message)
                }
            }
        )
    })
    // Dial to node2
    try {
        const stream = await node.dialProtocol(multiaddr('/ip4/127.0.0.1/tcp/60173/p2p/12D3KooWR6LEhbm89kKgDciA7GbxapRK99yuWZkrzaUDdqJhXXJi'), '/example/protocol');
    
        // Write data to the stream
        await pipe(
            [JSON.stringify(data)],
            // Turn strings into buffers
            (source) => map(source, (string) => uint8ArrayFromString(string)),
            // Encode with length prefix (so receiving side knows how much data is coming)
            (source) => lp.encode(source),
            stream.sink);
    
        // Read data from the stream
        await pipe(
            stream.source,
            // Decode length-prefixed data
            (source) => lp.decode(source),
            // Turn buffers into strings
            (source) => map(source, (buf) => uint8ArrayToString(buf.subarray())),
            async function (source) {
                for await (var message of source) {
                    discoveredPeers.concat(JSON.parse(message))
                    console.log('Discovered:', message)
                }
            }
        )
    } catch (err) {}
    // const bootstrapMulti = multiaddr('/dnsaddr/sg1.bootstrap.libp2p.io/p2p/QmcZf59bWwK5XFi76CZX8cbJ4BhTzzA3gU1ZjYZcYW3dwt')
    // node.handle()
    // const { stream, protocol } = await node.dialProtocol(bootstrapMulti, '/bootstrap/1')
    // const data = JSON.stringify({
    //     grpc: 'grpc addr',
    //     multi: node.getMultiaddrs()[0].toString(),
    //     http: 'http addr'
    // })
    // pipe([data], stream)

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
                await node.services.dht.refreshRoutingTable()
                break;
            case 'get':
                if (args.length !== 1) {
                    console.error('Usage: get <key>');
                    break;
                }
                await node.services.dht.refreshRoutingTable()
                await getValue(node, args[0]);
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
    let retrievedValue = node.services.dht.put(keyUint8Array, valueUint8Array, { useNetwork: true, useCache: false });
    for await (const queryEvent of retrievedValue) {
        console.log('put', queryEvent)
    }
    console.log(`Key "${key}" with value "${value}" successfully added to the dht.`);
}

async function getValue(node, key) {
    const keyUint8Array = new TextEncoder('utf8').encode(key);
    let retrievedValue
    retrievedValue = node.peerRouting.getClosestPeers(keyUint8Array)
    for await (const queryEvent of retrievedValue) {
        console.log('peerRouting', queryEvent)
    }
    retrievedValue = node.services.dht.get(keyUint8Array, { useNetwork: true, useCache: false });
    for await (const queryEvent of retrievedValue) {
        console.log('get', queryEvent)
    }
}

main();