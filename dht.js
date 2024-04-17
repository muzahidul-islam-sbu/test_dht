import { createLibp2p } from 'libp2p'
import { tcp } from '@libp2p/tcp'
import { noise } from '@chainsafe/libp2p-noise'
import { kadDHT } from '@libp2p/kad-dht'
import { yamux } from '@chainsafe/libp2p-yamux'
import { bootstrap } from '@libp2p/bootstrap'

async function createNode() {
    const node = await createLibp2p({
        addresses: {
            listen: ['/ip4/0.0.0.0/tcp/0']
        },
        transports: [tcp()],
        streamMuxer: [yamux()],
        connEncryption: [noise()],
        services: {
            dht: kadDHT({
                kBucketSize: 20,
            })
        },
        peerDiscovery: [
            bootstrap({
                list: [
                    // bootstrap node here is generated from dig command
                    '/dnsaddr/sg1.bootstrap.libp2p.io/p2p/QmcZf59bWwK5XFi76CZX8cbJ4BhTzzA3gU1ZjYZcYW3dwt'
                ]
            })
        ]
    });

    await node.start();
    return node;
}

async function main() {
    const node = await createNode();

    // Start the DHT
    await node.services.dht.start();

    // Put a key-value pair into the DHT
    const key = new Uint8Array(Buffer.from('hello')); 
    const value = new Uint8Array(Buffer.from('world')); 
    let retrievedValue = node.services.dht.put(key, value);
    for await (const queryEvent of retrievedValue) {
        console.log('put' , queryEvent)
    }
    // Get the value using the key
    retrievedValue = node.services.dht.get(key);
    for await (const queryEvent of retrievedValue) {
        console.log('get', queryEvent)
    }

    process.on('SIGTERM', () => node.stop())
    process.on('SIGINT', () => node.stop())
}

main();