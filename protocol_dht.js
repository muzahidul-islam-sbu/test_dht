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
import { getPublicMultiaddr } from './util.js'
let discoveredPeers = []
const dht = {};
async function main() {
    const node = await createNode();
    // Log peer discovery events
    // node.addEventListener('peer:discovery', async (connection) => {
    //     console.log('Discovered peer:', connection.detail.id, connection.detail.multiaddrs);
    // });

    // // Log peer connection events
    // node.addEventListener('peer:connect', async (connection) => {
    //     console.log('Connected to peer:', connection, connection.detail, connection.detail.multiaddrs);
    // });


    console.log('PeerID', node.peerId.toString());
    console.log(await getPublicMultiaddr(node))
    node.getMultiaddrs().forEach((addr) => {
        console.log(addr.toString());
    });

    // Start the DHT
    await node.services.dht.setMode('server');
    await node.services.dht.start();
    await node.start();

    const data = {
        multi: await getPublicMultiaddr(node),
        http: 'http addr',
        grpc: 'grpc addr'
    }

    await node.handle('/bootstrap', async ({ stream }) => {
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
        const stream = await node.dialProtocol(multiaddr('/ip4/127.0.0.1/tcp/63759/p2p/12D3KooWBdMHzcughjrfmAbYxuPQQGJVKa39ZH4xySXd5G5uq8ZY'), '/bootstrap');

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
                    discoveredPeers = discoveredPeers.concat(JSON.parse(message))
                    console.log('Discovered:', message)
                }
            }
        )
    } catch (err) { }

    await node.handle('/putDHT', async ({ stream }) => {
        pipe(
            stream.source,
            // Decode length-prefixed data
            (source) => lp.decode(source),
            // Turn buffers into strings
            (source) => map(source, (buf) => uint8ArrayToString(buf.subarray())),
            async function (source) {
                for await (var message of source) {
                    const {key, val} = JSON.parse(message)
                    if (!dht.hasOwnProperty(key)) { dht[key] = new Set() }
                    dht[key].add(JSON.stringify(val))

                    console.log('Put to DHT:', message)
                }
            }
        )
    })

    await node.handle('/getDHT', async ({ stream }) => {
        let key;
        await pipe(
            stream.source,
            // Decode length-prefixed data
            (source) => lp.decode(source),
            // Turn buffers into strings
            (source) => map(source, (buf) => uint8ArrayToString(buf.subarray())),
            async function (source) {
                for await (var message of source) {
                    key = JSON.parse(message)['key']
                }
            }
        )
        while (!key) {
            await new Promise(resolve => setTimeout(resolve, 1000));
        }
        const arrayFromSet = [...dht[key]]
        const val = arrayFromSet || ''
        await pipe(
            [JSON.stringify({key: val})],
            // Turn strings into buffers
            (source) => map(source, (string) => uint8ArrayFromString(string)),
            // Encode with length prefix (so receiving side knows how much data is coming)
            (source) => lp.encode(source),
            stream.sink,
        );
        console.log('Retrieved from DHT:', key, dht[key])
    })

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
    // node.peerId
}

async function putKeyValue(node, key, value) {
    if (!dht.hasOwnProperty(key)) { dht[key] = new Set() }

    const val ={ peerId: node.peerId.toString(), data: value }
    dht[key].add(JSON.stringify(val))
    
    console.log('discovered peers:', discoveredPeers)
    for (var peer of discoveredPeers) {
        console.log('starting to put in peer DHT', peer['multi'])
        const multiAddr = multiaddr(peer['multi'])
        try {
            const stream = await node.dialProtocol(multiAddr, '/putDHT');
            // Write data to the stream
            await pipe(
                [JSON.stringify({key, val})],
                // Turn strings into buffers
                (source) => map(source, (string) => uint8ArrayFromString(string)),
                // Encode with length prefix (so receiving side knows how much data is coming)
                (source) => lp.encode(source),
                stream.sink);
            console.log('Put in', peer['multi'])
        } catch (err) {console.log('wat')}
    }
}

async function getValue(node, keyOrig) {
    if (!dht.hasOwnProperty(keyOrig)) { dht[keyOrig] = new Set() }

    for (var peer of discoveredPeers) {
        console.log('starting to get from peer DHT', peer['multi'])
        const multiAddr = multiaddr(peer['multi'])
        try {
            const stream = await node.dialProtocol(multiAddr, '/getDHT');
            // Write data to the stream
            await pipe(
                [JSON.stringify({key: keyOrig})],
                // Turn strings into buffers
                (source) => map(source, (string) => uint8ArrayFromString(string)),
                // Encode with length prefix (so receiving side knows how much data is coming)
                (source) => lp.encode(source),
                stream.sink
            );
            // console.log('Requested from', peer['multi'], keyOrig)
            let val;
            // Read data from the stream
            await pipe(
                stream.source,
                // Decode length-prefixed data
                (source) => lp.decode(source),
                // Turn buffers into strings
                (source) => map(source, (buf) => uint8ArrayToString(buf.subarray())),
                async function (source) {
                    for await (var message of source) {
                        val = 1;
                        if (message == '') {break}
                        let {key} = JSON.parse(message) 
                        key = new Set(key);
                        const combined =  new Set([...dht[keyOrig], ...key])
                        dht[keyOrig] = combined
                        // console.log('Added from', peer['multi'], key)
                    }
                }
            )
            while (val === undefined) {
                await new Promise(resolve => setTimeout(resolve, 1000));
            }
        } catch (err) {console.log(err)}
    }
    console.log(dht[keyOrig])

}

main();