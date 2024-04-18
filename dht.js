import { createLibp2p } from 'libp2p'
import { tcp } from '@libp2p/tcp'
import { mdns } from '@libp2p/mdns'
import { noise } from '@chainsafe/libp2p-noise'
import { kadDHT, removePrivateAddressesMapper, EventTypes, removePublicAddressesMapper } from '@libp2p/kad-dht'
import { yamux } from '@chainsafe/libp2p-yamux'
import { bootstrap } from '@libp2p/bootstrap'

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
                kBucketSize: 20,
                allowQueryWithZeroPeers: true,
                querySelfInterval: 10,
                peerInfoMapper: removePublicAddressesMapper
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
async function main() {
    const node = await createNode();
    const discoveredPeerIds = []
    // Log peer discovery events
    node.addEventListener('peer:discovery', (connection) => {
        console.log('Discovered peer:' ,connection.detail.id, connection.detail.multiaddrs);
        discoveredPeerIds.push(connection.detail.id)
    });
    
    // Log peer connection events
    node.addEventListener('peer:connect', async (connection) => {
        console.log('Connected to peer:', connection, connection.detail, connection.detail.multiaddrs);
        
        let retrievedValue = node.services.dht.findPeer(connection.detail);
        for await (const queryEvent of retrievedValue) {
            console.log('connect' , queryEvent)
        }

        await node.dial(connection.detail)
    });

    node.addEventListener(EventTypes.VALUE, () => {
        console.log('found')
    })
    
    console.log('PeerID', node.peerId.toString());
    node.getMultiaddrs().forEach((addr) => {
        console.log(addr.toString());
    });
    
    // Start the DHT
    await node.services.dht.setMode('server');
    await node.services.dht.start();
    await node.start();
    
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
    let retrievedValue = node.services.dht.put(keyUint8Array, valueUint8Array ,{useNetwork: true, useCache: false});
    for await (const queryEvent of retrievedValue) {
        console.log('put' , queryEvent)
    }
    console.log(`Key "${key}" with value "${value}" successfully added to the DHT.`);
}

async function getValue(node, key) {
    const keyUint8Array =  new TextEncoder('utf8').encode(key);
    let retrievedValue
    retrievedValue = node.peerRouting.getClosestPeers(keyUint8Array)
    for await (const queryEvent of retrievedValue) {
        console.log('peerRouting' , queryEvent)
    }
    retrievedValue = node.services.dht.get(keyUint8Array,  {useNetwork: true, useCache: false});
    for await (const queryEvent of retrievedValue) {
        console.log('get' , queryEvent)
    }
}

main();