import { Signal } from './signal.js';
import {encode, decode } from '@msgpack/msgpack';

function genid(groupid='C', length=8, seqidx=1) {
    let id = groupid.charCodeAt(0).toString(16).padStart(2, '0');
    // wildcard is forbidden
    let forbidden = '*'.charCodeAt(0);
    for (let i = 0; i < length - groupid.length() - 1; i++) {
        let cur;
        do {
            cur = Math.floor(Math.random() * 256);
        } while (cur === forbidden);
        id += cur.toString(16).padStart(2, '0');
    }
    // Hexadecimal sequence index
    id += seqidx.toString(16).padStart(2, '0');
    return id;
}

class Client {
    constructor(client_id = null) {
        this.client_id = client_id || genid('C', 8, 1);
        this.address = `ws://127.0.0.1:5000/ws/${this.client_id}`;
        
        // Use the singal handler for regular/raw subscriptions
        this._emitter = new Signal('Subscription');
        this.ws = null;
        this.act_id = null;
    };

    connect(address = null, client_id = null) {
        if (this.ws && this.ws.readyState === WebSocket.OPEN) {
            console.warn('WebSocket already connected');
            return;
        }
        this.address = address || this.address;
        this.client_id = client_id || this.client_id;
        this.ws = new WebSocket(this.address);
        this.ws.binaryType = "arraybuffer";

        this.ws.onopen = () => {
            console.log('WebSocket connection opened');
        };

        this.ws.onmessage = (event) => {
            try {
                // expect: [to_group, topic, sender_id, data]
                const decoded = decode(new Uint8Array(event.data));
                const [to_group, topic, sender_id, data] = decoded;
                this._emitter.emit(topic, data, sender_id, to_group);
            } catch (e) {
                console.error('Error parsing WebSocket message:', e);
            }
        };

        this.ws.onerror = (error) => {
            console.error('WebSocket error:', error);
        };

        this.ws.onclose = () => {
            console.log('WebSocket connection closed');
        };
    }

    is_connected() {
        return this.ws && this.ws.readyState === WebSocket.OPEN;
    }

    // publish/send to server: encodes as [to_group, topic, sender_id, data]
    send(topic, data, to_group = '*') {
        if (!this.ws || this.ws.readyState !== WebSocket.OPEN) {
            console.warn('WebSocket not open, cannot send');
            return;
        }
        try {
            const payload = encode([to_group, topic, data]);
            this.ws.send(payload);
        } catch (e) {
            console.error('Error encoding/sending message', e);
        }
    }
}

// Export singleton instance
export default new Client();
