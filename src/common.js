export class SubscriptionEvent extends Event {
    constructor(type, data, senderId = null, actId = null, toGroup = '*') {
        super(type);
        this.data = data;
        this.senderId = senderId;
        this.toGroup = toGroup;
        this.actId = actId;
    }
};

export class SubscriptionType {
    static Regular = 'Regular';
    static SharedState = 'SharedState';
    static Unknown = 'Unknown';
}


export class Subscription {
    constructor(topic) {
        this.topic = topic;
        this.masks = new Set();
        this.requested = new Array();
        this.actonly = false;
        this.deferredSubs = new Array();
        this.subscriptionType = SubscriptionType.Unknown;
    }
}

export class ActionType {
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
