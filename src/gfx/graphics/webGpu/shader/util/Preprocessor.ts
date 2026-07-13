import { ShaderLib } from '../../../../../assets/shader/ShaderLib';
import { evalCondition, expand } from './PreprocessorExpr';

/**
 * @internal
 * @group GFX
 */
export class Preprocessor {

    public static parse(code: string, defineValue: { [name: string]: any }): string {
        code = this.filterComment(code);
        code = this.parsePreprocess(new PreprocessorContext(), code, defineValue);
        code = this.parseAutoBindingForAllGroup(code);
        code = this.parseAutoLocationBlock(code);
        return code;
    }

    public static parseComputeShader(code: string, defineValue: { [name: string]: any }): string {
        code = this.filterComment(code);
        code = this.parsePreprocess(new PreprocessorContext(), code, defineValue);
        code = this.parseAutoBindingForAllGroup(code);
        return code;
    }

    protected static parsePreprocess(context: PreprocessorContext, code: string, defineValue: { [name: string]: any }): string {
        // Header/tail (before the first and after the last directive) skip
        // command parsing but still need define substitution — a body line
        // like `const LIMIT = MAX_LIGHTS;` may sit outside the directive
        // block.
        let begIndex = code.indexOf('#');
        if (begIndex == -1) {
            return expand(code, defineValue);
        }
        let header = code.substring(0, begIndex);
        let endIndex = code.indexOf('\n', code.lastIndexOf('#'));
        let codeBlock = code.substring(begIndex, endIndex);
        let tail = code.substring(endIndex);
        return expand(header, defineValue) + this.parsePreprocessCommand(context, codeBlock, defineValue) + expand(tail, defineValue);
    }

    protected static parseAutoBindingForAllGroup(code: string): string {
        let offset = 0;
        let result = '';
        let group = new Map<number, number>();
        while (offset < code.length) {
            let nLeftIndex = code.indexOf('@group(', offset);
            if (nLeftIndex == -1) {
                result += code.substring(offset);
                break;
            }
            let nRightIndex = code.indexOf(')', nLeftIndex);
            let groupID = Number.parseInt(code.substring(nLeftIndex + 7, nRightIndex));
            nLeftIndex = code.indexOf('@binding(', nRightIndex);
            nRightIndex = code.indexOf(')', nLeftIndex);

            let bindingID = code.substring(nLeftIndex + 9, nRightIndex);

            result += code.substring(offset, nLeftIndex);
            if (bindingID.includes(`auto`)) {
                if (group.has(groupID)) {
                    let lastBindingId = group.get(groupID) + 1;
                    result += `@binding(${lastBindingId})`;
                    group.set(groupID, lastBindingId);
                } else {
                    result += '@binding(0)';
                    group.set(groupID, 0);
                }
            } else {
                let nBindingID = Number.parseInt(bindingID);
                if (!group.has(groupID) || group.get(groupID) < nBindingID) {
                    group.set(groupID, nBindingID);
                }
                result += `@binding(${bindingID})`;
            }
            offset = nRightIndex + 1;
        }

        return result;
    }

    protected static parseAutoBindingForGroupX(code: string, nGroup: number): string {
        let offset = 0;
        let result = '';
        let group = new Map<number, number>();
        while (offset < code.length) {
            let nLeftIndex = code.indexOf('@group(', offset);
            if (nLeftIndex == -1) {
                result += code.substring(offset);
                break;
            }
            let nRightIndex = code.indexOf(')', nLeftIndex);
            let groupID = Number.parseInt(code.substring(nLeftIndex + 7, nRightIndex));
            nLeftIndex = code.indexOf('@binding(', nRightIndex);
            nRightIndex = code.indexOf(')', nLeftIndex);

            // let bindingID = code.substring(nLeftIndex + 9, nRightIndex);

            result += code.substring(offset, nLeftIndex);
            if (groupID == nGroup) {
                if (group.has(groupID)) {
                    let lastBindingId = group.get(groupID) + 1;
                    result += `@binding(${lastBindingId})`;
                    group.set(groupID, lastBindingId);
                } else {
                    result += '@binding(0)';
                    group.set(groupID, 0);
                }
            } else {
                result += code.substring(nLeftIndex, nRightIndex + 1);
            }
            offset = nRightIndex + 1;
        }

        return result;
    }

    protected static parseAutoLocation(code: string): string {
        let offset = 0;
        let result = '';
        let lastBindingId = 0;
        while (offset < code.length) {
            let nLeftIndex = code.indexOf('@location(', offset);
            if (nLeftIndex == -1) {
                result += code.substring(offset);
                break;
            }
            let nRightIndex = code.indexOf(')', nLeftIndex);
            let id = code.substring(nLeftIndex + 10, nRightIndex);
            result += code.substring(offset, nLeftIndex);
            if (id === 'auto') {
                result += `@location(${lastBindingId})`;
                lastBindingId++;
            } else {
                result += code.substring(nLeftIndex, nRightIndex + 1);
            }
            offset = nRightIndex + 1;
        }
        return result;
    }

    protected static parseAutoLocationBlock(code: string): string {
        let offset = 0;
        let result = '';
        let lastBindingId = 0;
        while (offset < code.length) {
            let nLeftIndex = code.indexOf('@location(', offset);
            if (nLeftIndex == -1) {
                result += code.substring(offset);
                break;
            }
            let nRightIndex = code.indexOf('}', nLeftIndex);
            let nRightIndex2 = code.indexOf('->', nLeftIndex);
            if (nRightIndex2 != -1 && nRightIndex2 < nRightIndex) {
                nRightIndex = nRightIndex2;
            }
            let block = code.substring(nLeftIndex, nRightIndex + 1);
            block = this.parseAutoLocation(block);
            result += code.substring(offset, nLeftIndex);
            result += block;
            offset = nRightIndex + 1;
        }

        return result;
    }


    protected static parsePreprocessCommand(context: PreprocessorContext, code: string, defineValue: { [name: string]: any }): string {
        // Invariants keeping the two stacks in sync:
        //  - every #if pushes exactly one entry on BOTH stacks (also inside
        //    skipped regions), and #endif pops both;
        //  - `stack` top = "current branch is skipped";
        //  - `stackElseif` top = "some branch of this #if chain was already
        //    taken (or the whole region is skipped)" — #elseif/#else consult
        //    it so at most ONE branch of a chain is ever emitted.
        let result: string = '';
        let lines = code.split('\n');
        let stack: Array<boolean> = [false];
        let stackElseif: Array<boolean> = [false];
        for (let i: number = 0; i < lines.length; i++) {
            let line = lines[i];
            let skip = stack[stack.length - 1];
            if (line.trim().indexOf('#') != 0) {
                if (!skip) {
                    // C-preprocessor semantics: substitute define values into
                    // body identifiers (e.g. `const LIMIT = MAX_LIGHTS;`).
                    result += expand(line, defineValue) + '\n';
                }
                continue;
            }
            let command = line.trim();
            if (command.indexOf('#if') != -1) {
                if (skip) {
                    // Nested #if inside a skipped region: keep both stacks
                    // balanced and mark the chain as "taken" so its
                    // #elseif/#else branches stay skipped too.
                    stack.push(true);
                    stackElseif.push(true);
                    continue;
                }
                let condition = command.substring(3).trim();
                let taken = this.parseCondition(condition, defineValue);
                stack.push(!taken);
                stackElseif.push(taken);
                continue;
            } else if ((command.indexOf('#elseif') != -1) || (command.indexOf('#else') != -1 && command.indexOf(' if') != -1)) {
                stack.pop();
                let alreadyTaken = stackElseif[stackElseif.length - 1];
                if (alreadyTaken) {
                    // A previous branch matched (or the region is skipped).
                    stack.push(true);
                    continue;
                }
                let condition = command.substring(command.indexOf('if') + 2).trim();
                if (condition == '') {
                    console.error(`preprocess command error, conditions missing: ${command}`);
                }
                let taken = this.parseCondition(condition, defineValue);
                stack.push(!taken);
                if (taken) {
                    stackElseif[stackElseif.length - 1] = true;
                }
                continue;
            } else if (command.indexOf('#else') != -1) {
                stack.pop();
                let alreadyTaken = stackElseif[stackElseif.length - 1];
                // Emit the #else body only when no earlier branch matched.
                stack.push(alreadyTaken);
                if (!alreadyTaken) {
                    stackElseif[stackElseif.length - 1] = true;
                }
                continue;
            } else if (command.indexOf('#endif') != -1) {
                stack.pop();
                stackElseif.pop();
                continue;
            } else if (command.indexOf('#include') != -1) {
                let includeName = '';
                let char = command.charAt(command.length - 1);
                if (char == `>`) {
                    includeName = this.extract(command, '<', '>');
                } else {
                    includeName = this.extract(command, char, char);
                }

                if (!context.includeMap.has(includeName)) {
                    context.includeMap.set(includeName, true);

                    let code = ShaderLib.getShader(includeName);
                    if (!code) {
                        throw `${command} error: '${includeName}' not found`;
                    }

                    code = this.filterComment(code);
                    code = this.parsePreprocess(context, code, defineValue);
                    result += code + '\r\n';
                }
                continue;
            } else if (command.indexOf('#define ') != -1) {
                let expression = command.substring(command.indexOf('#define ') + 8).trim();
                let index = expression.indexOf(' ');
                let name = expression;
                let value = '';
                if (index != -1) {
                    name = expression.substring(0, index).trim();
                    value = expression.substring(index + 1).trim();
                }
                defineValue[name] = value;
                continue;
            } else throw 'nonsupport: ' + command;
        }
        return result;
    }

    protected static parseCondition(condition: string, defineValue: { [name: string]: any }): boolean {
        try {
            // One expansion pass first so chained defines (#define A B,
            // #define B 1, `#if A == 1`) resolve: expand rewrites A -> B,
            // evalCondition's identifier lookup then resolves B -> 1.
            return evalCondition(expand(condition, defineValue), defineValue);
        } catch (e) {
            console.error(`preprocess condition parse error: '${condition}'`, e);
            return false;
        }
    }

    public static filterComment(code: string): string {
        let result = '';
        let findSingleComment = true;
        let findMultiComment = true;
        for (let offset = 0; offset < code.length;) {
            let index1 = findSingleComment ? code.indexOf('//', offset) : -1;
            let index2 = findMultiComment ? code.indexOf('/*', offset) : -1;

            if (index1 == -1 && index2 == -1) {
                result += code.substring(offset);
                break;
            }

            findSingleComment = index1 != -1;
            findMultiComment = index2 != -1;

            if (index1 != -1 && index2 != -1) {
                if (index1 < index2) {
                    index2 = -1;
                } else {
                    index1 = -1;
                }
            }

            if (index1 != -1) {
                index2 = code.indexOf('\n', index1);
                result += code.substring(offset, index1);
                offset = index2 != -1 ? index2 : code.length;
            } else if (index2 != -1) {
                index1 = code.indexOf('*/', index2);
                result += code.substring(offset, index2);
                offset = index1 + 2;
            }
        }

        return result;
    }

    protected static extract(str: string, leftStr: string, rightStr: string): string {
        let indexL = str.indexOf(leftStr) + leftStr.length;
        let indexR = str.indexOf(rightStr, indexL);
        return str.substring(indexL, indexR).trim();
    }
}

class PreprocessorContext {
    public includeMap = new Map<string, boolean>();

    constructor() {
    }
}
