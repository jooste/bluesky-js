import { Signal } from './signal.js';


class ActionType {
    static Append = 'A';
    static Extend = 'E';
    static Delete = 'D';
    static Update = 'U';
    static Replace = 'R';
    static Reset = 'X';
    static ActChange = 'C';
    static NoAction = '';

    static isaction(type) {
        return Object.values(ActionType).includes(type) && type !== ActionType.NoAction;
    }
}


class SharedState {
    static signal = new Signal('SharedState');

    constructor() {
        this.defaults = {};
        this.remotes = new Map();  // client_id -> {topic: Store}
    }

    reset(remote_id = null) {
        this.remotes[remote_id || act_id] = structuredClone(this.defaults);

        // signalling logic
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
    }

}



export default new SharedState();

export { ActionType };