import { SubscriptionEvent, ActionType } from './common.js';


class SharedState extends EventTarget {
    constructor() {
        super();
        this.defaults = {};
        this.remotes = new Map();  // clientId -> {topic: Store}
        this.actId = '';
    }

    reset(remoteId) {
        const stores = structuredClone(this.defaults);
        this.remotes.set(remoteId, stores);

        // communicate this update if it belongs to the active node
        if (remoteId == this.actId) {
            for (const [topic, store] of stores.items()) {
                this.dispatchEvent(
                    new SubscriptionEvent(topic, store, remoteId, "")
                );
            }
        }
    }

    setActNode(actId) {
        let remote = this.remotes.get(actId);
        if (remote === undefined) {
            remote = structuredClone(this.defaults);
            this.remotes.set(actId, remote);
        }
        this.actId = actId;
        for (const [topic, store] of Object.entries(remote)) {
            this.dispatchEvent(
                new SubscriptionEvent(topic, store, actId, "")
            );
        }
    }

    addtopic(topic) {
        const t = topic.toLowerCase();
        // ensure defaults and existing remotes have this group
        if (!(t in this.defaults)) {
            this.defaults[t] = new Object();
            for (const store of this.remotes.values()) {
                store[t] = new Object();
            }
        }
    }

    isSharedState(topic) {
        return topic in this.defaults;
    }

    onSharedStateReceived(event) {
        // TODO: implement
        const action = event.data[0];
        let store = this.remotes.get(event.senderId);
        if (store === undefined) {
            store = structuredClone(this.defaults);
            this.remotes.set(event.senderId, store);
            // console.error(`SharedState store not found for node with ID ${event.senderId}`);
            return;
        }
        switch(action) {
            case ActionType.Update:
                // Recursively merge the new data with the current store
                mergeStores(store, event.data[1]);
                break;
            case ActionType.Append:
            case ActionType.Extend:
                for (const [key, value] of Object.entries(event.data[1])) {
                    if (!store.hasOwnProperty(key)) {
                        // Array doesn't exist yet. Create it with data as first element
                        store[key] = new Array(value);
                        
                    } else {
                        // Array already exists. Append the single new value to the Array
                        store[key].push(value);
                    }
                }
                break;

            case ActionType.Replace:
                for (const [key, value] of Object.entries(event.data[1])) {
                    store[key] = value;
                }
                break;

            case ActionType.Delete:
                let idx = null;
                for (const [key, value] of Object.entries(event.data[1])) {
                    if (!store.hasOwnProperty(key)) {
                        if (typeof value === 'number' && Number.isInteger(value)) {
                            idx = value;
                        } else {
                            console.error(`Expected integer index for delete ${key} in topic ${event.type}`);
                            break;
                        }

                    } else {
                        // Assume we are receiving a lookup key for a reference value
                        let ref = store[key];
                        if (Array.isArray(ref)) {
                            idx = ref.indexOf(value);
                        } else {
                            // ref is a dictionary: this delete action should only act on this dict
                            if (Array.isArray(value)) {
                                for (const delkey of value) {
                                    delete ref[delkey];
                                }
                            } else {
                                delete ref[value];
                            }
                            break;
                        }
                    }
                    if (idx === null || idx == -1) {
                        break;
                    }
                    // Delete value at index 'idx' for all arrays
                    for (let attr of Object.values(store)) {
                        if (Array.isArray(attr)) {
                            attr.splice(idx, 1);
                        }
                    }
                }
                break;

            case ActionType.Reset:
                return this.reset(event.senderId);
            case ActionType.ActChange:
                return this.setActNode(event.senderId);
        }
        // Inform subscribers of state update
        if (event.senderId == this.actId) {
            this.dispatchEvent(
                new SubscriptionEvent(event.type, store, event.senderId, event.toGroup)
            );
        }
    }
}


function mergeStores(target, source) {
    // Iterate over all attributes of source
    for (const [key, value] of Object.entries(source)) {
        if (target[key] && typeof value === 'object') {
            // Recursively merge if it's a nested object
            mergeStores(target[key], value);
        } else {
            // Otherwise just copy
            target[key] = value;
        }
    }
}


export default new SharedState();

export { ActionType };