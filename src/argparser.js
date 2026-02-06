const reGetarg = /\s*['"]?((?<=['"])[^'"]*|(?<!['"]])[^\s,]*)['"]?\s*,?\s*(.*)/;

export function getNextArg(cmdString) {
    const match = reGetarg.exec(cmdString);
    return match ? [match[1], match[2]] : ['', ''];
}