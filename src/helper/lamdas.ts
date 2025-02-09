/**
 * Copyright 2023 University of Adelaide
 *
 * Licensed under the Apache License, Version 2.0 (the "License");
 * you may not use this file except in compliance with the License.
 * You may obtain a copy of the License at
 *
 *    http://www.apache.org/licenses/LICENSE-2.0
 *
 * Unless required by applicable law or agreed to in writing, software
 * distributed under the License is distributed on an "AS IS" BASIS,
 * WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or implied.
 * See the License for the specific language governing permissions and
 * limitations under the License.
 */

import { mkdirSync, writeFileSync } from "fs";
import { dirname } from "path";

import { ByteRegister, Flags, FUNCTIONS, Register, XmmRegister } from "@/enums";
import Logger from "@/helper/Logger.class";
import type { Allocation, asm, CryptOpt, imm, mem, U1Allocation, U64Allocation } from "@/types";

import {
  ARG_PREFIX,
  ARG_PREFIX_REGEX,
  ARG_REGEX,
  CALLER_SAVE_PREFIX,
  IMM_31_BIT_IMM,
  IMM_64_BIT_IMM,
  IMM_REGEX,
  MEM_REGEX,
  OUT_PREFIX,
  XD_REGEX,
} from "./constants";
import { getQwRegFromByteReg } from "./reg-conversion";
//Lamdas means here just helper functions, which dont need any imports.
// so don't specify any imports there. Put those into ./helpers.ts
// this is done to remove circular dependencies while ensuring low amount of code duplication
export function SI(a: number): string {
  if (a === 0) return " zero";
  const exp = Math.floor(Math.log10(a) / 3);
  const suff = ["", "k", "M", "T"][exp];
  return `${(a / Math.pow(1000, exp)).toPrecision(3)}${suff}`.padStart(5);
}

// splits strings at _ and writes numbers as base16
export function toImm(val: string | number): imm {
  if (typeof val === "string") {
    return val;
  }
  return val < 0 ? `-0x${(-val).toString(16)}` : `0x${val.toString(16)}`;
}
// gets the memorylocation for a given offset
export function toMem(offset: number | string, base: Register = Register.rsp): mem {
  offset = Number(offset) * 8;
  if (offset < 0) {
    return `[ ${base} - 0x${(-offset).toString(16)} ]`;
  } else {
    return `[ ${base} + 0x${offset.toString(16)} ]`;
  }
}

export function matchXD(variable: string | null | undefined): RegExpMatchArray | null {
  if (!variable) {
    return null;
  }
  return variable.match(XD_REGEX);
}
export function isXD(variable: string | null | undefined): variable is CryptOpt.Varname {
  return !!variable?.match(XD_REGEX);
}
export function assertXD(variable: string | null | undefined): asserts variable is CryptOpt.Varname {
  if (!isXD(variable)) {
    throw new Error(`${variable} is not xd, which is should be`);
  }
}

export function matchIMM(variable: string | null | undefined): RegExpMatchArray | null {
  if (!variable) {
    return null;
  }
  return variable.match(IMM_REGEX);
}
export function isCallerSave(variable: string | null | undefined): boolean {
  if (!variable) {
    return false;
  }
  return variable.startsWith(CALLER_SAVE_PREFIX);
}
export function matchArgPrefix(variable: string | null | undefined): RegExpMatchArray | null {
  if (!variable) {
    return null;
  }
  return variable.match(ARG_PREFIX_REGEX);
}
export function matchArg(variable: string | null | undefined): RegExpMatchArray | null {
  if (!variable) {
    return null;
  }
  return variable.match(ARG_REGEX);
}
// matches argN[n]
export function isReadOnlyMemory(variable: string | null | undefined): boolean {
  return variable?.match(ARG_REGEX)?.groups?.base?.startsWith(ARG_PREFIX) ?? false;
}
// matches outN[n]
export function isWriteOnlyMemory(variable: string | null | undefined): boolean {
  return variable?.match(ARG_REGEX)?.groups?.base?.startsWith(OUT_PREFIX) ?? false;
}
export function matchMem(variable: string | null | undefined): RegExpMatchArray | null {
  if (!variable) {
    return null;
  }
  return variable.match(MEM_REGEX);
}

export function isRegister(test: string | undefined | null): test is Register {
  if (!test) {
    return false;
  }
  for (const r in Register) {
    if (r === test) return true;
  }
  return false;
}
export function isXmmRegister(test: string | undefined | null): test is XmmRegister {
  if (!test) {
    return false;
  }
  for (const r in XmmRegister) {
    if (r === test) return true;
  }
  return false;
}

export function isByteRegister(test: string | undefined | null): test is ByteRegister {
  if (!test) {
    return false;
  }
  for (const r in ByteRegister) {
    if (r === test) return true;
  }
  return false;
}

export function isFlag(test?: string): test is Flags {
  if (!test) {
    return false;
  }
  return [Flags.CF, Flags.OF].includes(test as Flags);
}

export function isImm(test: string | object): test is imm {
  return typeof test === "string" && IMM_REGEX.test(test);
}

export function isMem(test?: string): test is mem {
  if (!test) {
    return false;
  }
  return MEM_REGEX.test(test);
}

export function isNotNoU<T>(arg: T | null | undefined): arg is T {
  return !(arg === null || arg === undefined);
}

export const beautify = (instruction: asm): string =>
  instruction
    .split(";")
    .map((a) => a.padEnd(40))
    .join(";");

// will get rid of all undefined entries and entries less than 1 and return the MIN of the resulting numbers
export function getMin(arr: Array<number | undefined>): number {
  const ns = arr.filter((v) => typeof v === "number" && v > 0) as number[];
  return Math.min(...ns);
}

// can also take an undefined input; returns F_A then
export function toggleFUNCTIONS(f: FUNCTIONS = FUNCTIONS.F_B): FUNCTIONS {
  return f === FUNCTIONS.F_A ? FUNCTIONS.F_B : FUNCTIONS.F_A;
}

export function toggleFlag(f: Flags): Flags {
  return f === Flags.CF ? Flags.OF : Flags.CF;
}

export function zx(br: ByteRegister | Register): { inst: asm; reg: Register } {
  if (isRegister(br)) {
    return { inst: `; why am i here ? ${br} is already a qw reg`, reg: br };
  }

  const reg = getQwRegFromByteReg(br);
  return { inst: `movzx ${reg}, ${br}`, reg };
}
export const isU64 = (va: Allocation | undefined | null): va is U64Allocation =>
  (va && "datatype" in va && va.datatype === "u64") || false;

export const isU1 = (va: Allocation | undefined | null): va is U1Allocation =>
  (va && "datatype" in va && va.datatype === "u1") || false;

export const assertStringArguments: (
  c: CryptOpt.Argument,
) => asserts c is CryptOpt.ArgumentWithStringArguments = (c) => {
  if (typeof c === "string" || c.arguments.length == 0 || c.arguments.some((a) => typeof a !== "string")) {
    throw new Error(` ${JSON.stringify(c)} was used with hierarchical arguments. This is not yet supported`);
  }
};

export const assertStringNames: (c: CryptOpt.Argument) => asserts c is CryptOpt.ArgumentWithStringNames = (
  c,
) => {
  if (typeof c === "string") {
    throw new Error(`Argument is expected to be an object, but it is a string: ${c}. Assertion Failed.`);
  }
  if (c.name.length < 1 || c.name.length > 2) {
    throw new Error(
      `Argument is expected to be an object with names being a tuple with 1 or 2 elements, instead it has ${c.name.length} elements. Assertion Failed.`,
    );
  }
  const a = [1, 12] as [number, number] | [];
  a.every((a) => a + 1);

  if (c.name.some((a) => typeof a !== "string")) {
    throw new Error(`${c} is a operation which has names wh, which are not all strings.`);
  }
};
export function setToString(s: Set<string>, max = Infinity): string {
  let depstring = '"';
  let i = 0;
  for (const v of s.values()) {
    depstring += i == 0 ? v : `, ${v}`;

    if (i++ == max) {
      return `${depstring} [10 ... rest trunctated]"`;
    }
  }
  return depstring + '"';
}

export function writeString(filename: string, asmString: string): void {
  Logger.log(`writing ${asmString.length} chars of asm to '${filename}'`);
  mkdirSync(dirname(filename), { recursive: true });
  writeFileSync(filename, asmString);
}

export function limbify(
  arg:
    | CryptOpt.DynArgument["name"]
    | CryptOpt.DynArgument["name"][number]
    | CryptOpt.ArgumentWithStringArguments["arguments"]
    | CryptOpt.ArgumentWithStringArguments["arguments"][number],
) {
  let xdd;
  if (Array.isArray(arg)) {
    if (arg.length > 1) {
      throw new Error("Are you sure you want to limbify this ?");
    }
    xdd = arg[0];
  } else {
    xdd = arg;
  }
  const match = matchXD(xdd);
  if (match && !match?.[2]) {
    // if there is a match, but no _d
    return [`${xdd}_0`, `${xdd}_1`] as [CryptOpt.VarnameL, CryptOpt.VarnameL];
  }
  // either no match (aka imm/out1/...) or it already has a limb
  return [xdd] as [CryptOpt.VarnameL];
}
/**
 * This one cuts of the n-part from xDD_n
 */
export function delimbify(
  arg: CryptOpt.ArgumentWithStringArguments["arguments"][number] | CryptOpt.Varname,
): Exclude<CryptOpt.ArgumentWithStringArguments["arguments"][number], CryptOpt.VarnameL> {
  const xdd = arg.match(/(?<xdd>x\d+)_\d/)?.groups?.xdd as undefined | CryptOpt.VarnameNL;
  // we can cast because if it would be VarnameL, than it would match and we would return VarnameNL... TypeScript doesn't know this though
  return (
    xdd ?? (arg as Exclude<CryptOpt.ArgumentWithStringArguments["arguments"][number], CryptOpt.VarnameL>)
  );
}

/**
 * as in: safe unsigned.
 * as in: must be smaller than
 */
export function isSafeImm32(a: string) {
  if (a.startsWith("-")) {
    throw new Error("unimplemented");
  }
  const n = BigInt(a);
  // for now: positive,
  return n > 0 && n <= BigInt(IMM_31_BIT_IMM);
}

/**
 * This one cuts long imms in to its 64-bits parts
 * or gives back just one limb
 */
export function limbifyImm<T extends CryptOpt.ArgumentWithStringArguments["arguments"][number]>(i: T) {
  // return if its not imm
  if (!isImm(i)) {
    return [i] as [T];
  }
  const isNeg = i.startsWith("-");
  const abs_i = i.replaceAll("-", "") as T;
  // if that imm is shorter than that, we know it's less that 64 bits. and we just return
  if (abs_i.length <= IMM_64_BIT_IMM.length) {
    return [i] as [T];
  }

  if (isNeg) {
    throw new Error(` >${i}< is negative and bigger than IMM_64_BIT_IMM, we don't know what to to.`);
  }
  // else positive and long
  const groups = /0x(?<hi>\w{1,16})(?<lo>\w{16})$/.exec(i)?.groups;
  if (!groups) {
    throw new Error("Invalid immediate number.");
  }
  return [`0x${groups.lo}`, `0x${groups.hi}`] as [CryptOpt.HexConstant, CryptOpt.HexConstant];
}

export function makeU64NameLimbs<T extends CryptOpt.ArgumentWithStringNames>(node: T) {
  const r = node.datatype == "u128" ? limbify(node.name) : node.name;
  // until https://github.com/microsoft/TypeScript/issues/44373 is adressed
  return r as Array<CryptOpt.Varname | "_">;
}

export function shouldProof({ proof, bridge }: { proof: boolean; bridge?: string }): boolean {
  return proof && (typeof bridge == "undefined" || ["fiat", ""].includes(bridge));
}

export function padSeed(seed: string | number): string {
  return seed.toString().padStart(16, "0");
}
