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
import { execSync } from "child_process";
import { readFileSync } from "fs";
import { resolve } from "path";

import { errorOut, ERRORS } from "@/errors";
import { datadir, env, preprocessFunction } from "@/helper";
import Logger from "@/helper/Logger.class";
import type { CryptOpt } from "@/types";

import { lockAndRunOrReturn } from "../bridge.helper";
import { Bridge } from "../bridge.interface";
import { AVAILABLE_METHODS, METHOD_DETAILS, METHOD_T } from "./constants";
import { BCBPreprocessor } from "./preprocess";
import type { raw_T } from "./raw.type";

const cwd = resolve(datadir, "bitcoin-core-bridge");

const createExecOpts = () => {
  const c = { env, cwd, shell: "/usr/bin/bash" };
  c.env.CFLAGS = `-DUSE_ASM_X86_64 ${c.env.CFLAGS}`;
  return c;
};

export class BitcoinCoreBridge implements Bridge {
  public getCryptOptFunction(method: METHOD_T, _curve?: string): CryptOpt.Function {
    if (!(method in METHOD_DETAILS)) {
      throw new Error(`unsupported method '${method}'. Choose from ${AVAILABLE_METHODS.join(", ")}.`);
    }

    const raw = JSON.parse(readFileSync(resolve(cwd, "field.json")).toString()) as Array<raw_T>;

    const found = raw.find(({ operation }) => operation == METHOD_DETAILS[method].name);

    if (!found) {
      throw new Error(
        `${METHOD_DETAILS[method].name} not found. TSNH. Available '#${raw.length}':${raw.map(
          ({ operation }) => operation,
        )}`,
      );
    }

    // raw preprocessing (i.e. llvm->fiat)
    const fiat = new BCBPreprocessor().preprocessRaw(found);

    // 'normal' preprocessing (fiat-> cryptopt)
    const cryptOpt = preprocessFunction(fiat);
    return cryptOpt;
  }

  public machinecode(filename: string, method: METHOD_T): string {
    if (!filename.endsWith(".so")) {
      throw Error(`filename must end with .so, but instead is '${filename}'`);
    }

    const opts = createExecOpts();
    const command = `make -C ${cwd} all`; // to get scalar.c / field.c
    Logger.log(`cmd to generate machinecode: ${command} w opts: ${JSON.stringify(opts)}`);

    try {
      // yeah.
      // we need to all lock at the same thing.
      // if we'd lock at the `filename` everybody locks to some temporary file
      lockAndRunOrReturn(cwd, command, opts);

      // then create the so files. we dont need locks for this.
      execSync(`make -C ${cwd} ${filename}`, opts);
    } catch (e) {
      errorOut(ERRORS.bcbMakeFail);
    }

    return METHOD_DETAILS[method].name;
  }

  public argnumin(m: METHOD_T): number {
    switch (m) {
      case "square":
        return 1;

      case "mul":
        return 2;
    }
  }

  public argnumout(_m: METHOD_T): number {
    return 1;
  }

  public argwidth(_c: string, m: METHOD_T): number {
    switch (m) {
      case "mul":
      case "square":
        return 5;

      // case "scmul": // more like out:8, in0:8
      // case "reduce": // more like out:8, in0:4, in1:4
      // return 8;
    }
  }
  public bounds(_c: string, m: METHOD_T): CryptOpt.HexConstant[] {
    // from https://github.com/bitcoin-core/secp256k1/blob/423b6d19d373f1224fd671a982584d7e7900bc93/src/field_5x52_int128_impl.h#L162

    let bits = [] as number[]; // for field's
    if (m == "mul" || m == "square") {
      bits = [56, 56, 56, 56, 52]; // for field's
    }

    return bits.map((bitwidth) => {
      if (bitwidth % 4 !== 0) {
        throw new Error("unsuppoted bitwidth");
      }
      bitwidth /= 4;
      return `0x${Array(bitwidth).fill("f").join("")}` as CryptOpt.HexConstant;
    });
  }
}

// new BitcoinCoreBridge().getFiatFunction("square");
