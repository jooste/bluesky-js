import client from './client.js'
import { getNextArg } from './argparser.js';

class Stack {
    constructor() {
        this.commands = new Map();
        this.curCmd = '';
    }

    stack(cmdline, senderId='') {
        this.curCmd = cmdline;
        let cmd, args;
        [cmd, args] = getNextArg(cmdline);
        let cmdu = cmd.toUpperCase();
        const cmdobj = this.commands.get(cmdu);
        if (cmdobj === undefined && senderId === '') {
            this.forward();
        } else {
            const pargs = [];
            // TODO: convert string arguments
            while (args) {
                let arg;
                arg, args = getNextArg(args);
                pargs.push(arg);
            }
            cmdobj.call(...pargs);
        }
        this.curCmd = '';
    }

    forward(cmdline='', targetId='') {
        client.send('STACK', cmdline || this.curCmd, targetId);
    }

    command(name, func, { brief = '', aliases = [], annotations = '', help = '' }) {
        const uname = name.toUpperCase();
        const cmdobj = Command(uname, func, { brief: brief, aliases: aliases, annotations: annotations, help: help });
        this.commands.set(uname, cmdobj);
        return cmdobj;
    }
};


class Command {
    constructor(name, func, {brief='', aliases=[], annotations='', help=''}) {
        this.callback = func;
        this.name = name;
        this.brief = brief;
        this.aliases = aliases;
        this.annotations = annotations;
        this.help = help;
    }

    call(...args) {
        return this.callback(...args);
    }
};

// Export a single instance of Stack
export default new Stack();