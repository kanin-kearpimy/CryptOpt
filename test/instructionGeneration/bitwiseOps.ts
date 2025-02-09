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

/* eslint-disable @typescript-eslint/no-non-null-assertion */
import type { SpyInstance } from "vitest";
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";

import {
  AllocationFlags,
  ByteRegister,
  C_DI_INSTRUCTION_AND,
  C_DI_SPILL_LOCATION,
  DECISION_IDENTIFIER,
  Register,
} from "@/enums";
import { LSB_MAPPING } from "@/helper";
import { bitwiseOp } from "@/instructionGeneration/bitwiseOps";
import { Paul } from "@/paul";
import type { AllocationReq, Allocations, CryptOpt } from "@/types";

let paulChooseAndSpy: SpyInstance;
const allocate = vi.fn();
const getCurrentAllocations = vi.fn();
const declare128 = vi.fn();
const zext = vi.fn();
const lazyMov = vi.fn();
const declareDatatypeForVar = vi.fn();

beforeAll(() => {
  paulChooseAndSpy = vi.spyOn(Paul, "chooseInstructionAND");
});
beforeEach(() => {
  paulChooseAndSpy.mockClear();
  allocate.mockClear();
  getCurrentAllocations.mockClear();
  declareDatatypeForVar.mockClear();
});
afterAll(() => {
  paulChooseAndSpy.mockRestore();
});

vi.mock("@/registerAllocator/RegisterAllocator.class.ts", () => {
  return {
    RegisterAllocator: {
      getInstance: () => {
        return {
          allocate,
          getCurrentAllocations,
          declareFlagState: () => {
            /**intentionally empty */
          },
          pres: [],
          declare128,
          initNewInstruction: () => {
            /**intentionally empty */
          },
          zext,
          lazyMov,
          declareDatatypeForVar,
        };
      },
    },
  };
});
describe("instructionGeneration:and", () => {
  it("should allocate read x22_0 and x22_1 because arguments[1] is > u64", () => {
    allocate.mockImplementation((req: AllocationReq) => {
      const [oReg0 /*lo*/, oReg1 /*hi*/] = req.oReg;
      const [in0, in1, in2, in3] = req.in;
      expect(oReg0).toEqual("x23_0");
      expect(oReg1).toEqual("x23_1");
      expect(in0).toEqual("x22_0");
      expect(in1).toEqual("x22_1");
      expect(in2).toEqual("0x0000000000000000");
      expect(in3).toEqual("0x1");

      expect(req.allocationFlags).toBeTruthy();
      expect(req.allocationFlags! & AllocationFlags.DISALLOW_IMM).toBeTruthy();
      expect(req.allocationFlags! & AllocationFlags.IN_0_AS_OUT_REGISTER).toBeTruthy();
      expect(req.allocationFlags! & AllocationFlags.SAVE_FLAG_OF).toBeTruthy();
      expect(req.allocationFlags! & AllocationFlags.SAVE_FLAG_CF).toBeTruthy();

      return {
        oReg: [Register.r9, Register.r8],
        in: [Register.r9, Register.rbx, Register.rcx, Register.rdx],
      };
    });
    getCurrentAllocations.mockImplementation(() => {
      return {
        x22: { datatype: "u128" },
        x22_0: { datatype: "u64", store: Register.r9 },
        x22_1: { datatype: "u64", store: Register.r10 },
      } as Allocations;
    });
    const c: CryptOpt.StringOperation = {
      name: ["x23"],
      datatype: "u128",
      operation: "&",
      decisions: {
        di_choose_arg: [1, ["x22", "0x10000000000000000"]],
        [DECISION_IDENTIFIER.DI_SPILL_LOCATION]: [
          0,
          [C_DI_SPILL_LOCATION.C_DI_MEM, C_DI_SPILL_LOCATION.C_DI_XMM_REG],
        ],
      },
      decisionsHot: [],
      arguments: ["x22", "0x10000000000000000"],
    };
    Paul.currentInstruction = c; // usually done in the instructionGeneration.ts
    const code = bitwiseOp(c);
    expect(getCurrentAllocations).toBeCalled();
    expect(allocate).toBeCalled();
    expect(code).toHaveLength(3);
    expect(code[0]).toMatch(/and r9, rcx/);
    expect(code[1]).toMatch(/mov r8, rbx/); //
    expect(code[2]).toMatch(/and r8, rdx/);
    expect(declare128).toBeCalled();
  });
  it("should allocate x67, and with <=u64 imm, and call zext C_AND, Rely on Paul", () => {
    allocate.mockImplementation((req: AllocationReq) => {
      const [oReg0 /*lo*/, oReg1 /*hi*/] = req.oReg;
      const [in0, in1, in2] = req.in;
      expect(oReg0).toEqual("x67");
      expect(oReg1).toEqual(undefined);
      expect(in0).toEqual("x66_0");
      expect(in1).toEqual("0xfffffffffffff");
      expect(in2).toEqual(undefined);

      expect(req.allocationFlags).toBeTruthy();
      expect(req.allocationFlags! & AllocationFlags.DISALLOW_IMM).toBeTruthy();
      expect(req.allocationFlags! & AllocationFlags.IN_0_AS_OUT_REGISTER).toBeTruthy();
      expect(req.allocationFlags! & AllocationFlags.SAVE_FLAG_OF).toBeTruthy();
      expect(req.allocationFlags! & AllocationFlags.SAVE_FLAG_CF).toBeTruthy();

      return {
        oReg: [Register.r10],
        in: [Register.r10, Register.rax],
      };
    });
    getCurrentAllocations.mockImplementation(() => {
      return {
        x66_0: { datatype: "u64", store: "rbx" },
        x66_1: { datatype: "u64", store: "r9" },
        x66: { datatype: "u128" },
      } as Allocations;
    });

    // this instruction could deliberately choose to delete x66_1, but I think the entire x66 will be deleted anyhow. lets see, if this will be an issue later on (to have deps on x66_0, but not on x66_1, thus x66_1 wouldnt be deleted cus not all x66-limbs are not used anymore, but x66_1 could..).
    const c: CryptOpt.StringOperation = {
      name: ["x67"],
      datatype: "u128",
      operation: "&",
      decisions: {
        [DECISION_IDENTIFIER.DI_CHOOSE_ARG]: [1, ["x66", "0xfffffffffffff"]],
        [DECISION_IDENTIFIER.DI_INSTRUCTION_AND]: [
          0,
          [C_DI_INSTRUCTION_AND.C_AND, C_DI_INSTRUCTION_AND.C_BZHI],
        ],
        [DECISION_IDENTIFIER.DI_SPILL_LOCATION]: [
          0,
          [C_DI_SPILL_LOCATION.C_DI_MEM, C_DI_SPILL_LOCATION.C_DI_XMM_REG],
        ],
      },
      decisionsHot: [],
      arguments: ["x66", "0xfffffffffffff"],
    };
    Paul.currentInstruction = c; // usually done in the instructionGeneration.ts
    const code = bitwiseOp(c);
    expect(getCurrentAllocations).toBeCalled();
    expect(allocate).toBeCalled();
    expect(code).toHaveLength(2);
    expect(code[0]).toMatch(/;.*/);
    expect(code[1]).toMatch(/and r10, rax.*/);
    expect(zext).toBeCalled();
    expect(paulChooseAndSpy).toBeCalled();
  });
  it("should allocate x67, and with <=u64 imm, and call zext C_BZHI, rely on Paul", () => {
    allocate.mockImplementation((req: AllocationReq) => {
      const [oReg0 /*lo*/, oReg1 /*hi*/] = req.oReg;
      const [in0, in1, in2] = req.in;
      expect(oReg0).toEqual("x67");
      expect(oReg1).toEqual(undefined);
      expect(in0).toEqual("x66_0");
      const nu = LSB_MAPPING["0xfffffffffffff"];
      expect(in1).toEqual(nu);
      expect(in2).toEqual(undefined);

      expect(req.allocationFlags).toBeTruthy();
      expect(req.allocationFlags! & AllocationFlags.DISALLOW_IMM).toBeTruthy();
      expect(req.allocationFlags! & AllocationFlags.SAVE_FLAG_OF).toBeTruthy();
      expect(req.allocationFlags! & AllocationFlags.SAVE_FLAG_CF).toBeTruthy();

      return {
        oReg: [Register.r10],
        in: [Register.rbx, Register.rax],
      };
    });
    getCurrentAllocations.mockImplementation(() => {
      return {
        x66_0: { datatype: "u64", store: "rbx" },
        x66_1: { datatype: "u64", store: "r9" },
        x66: { datatype: "u128" },
      } as Allocations;
    });

    // this instruction could deliberately choose to delete x66_1, but I think the entire x66 will be deleted anyhow. lets see, if this will be an issue later on (to have deps on x66_0, but not on x66_1, thus x66_1 wouldnt be deleted cus not all x66-limbs are not used anymore, but x66_1 could..).
    const c: CryptOpt.StringOperation = {
      name: ["x67"],
      datatype: "u128",
      operation: "&",
      decisions: {
        [DECISION_IDENTIFIER.DI_CHOOSE_ARG]: [1, ["x66", "0xfffffffffffff"]],
        [DECISION_IDENTIFIER.DI_INSTRUCTION_AND]: [
          1,
          [C_DI_INSTRUCTION_AND.C_AND, C_DI_INSTRUCTION_AND.C_BZHI],
        ],
        [DECISION_IDENTIFIER.DI_SPILL_LOCATION]: [
          0,
          [C_DI_SPILL_LOCATION.C_DI_MEM, C_DI_SPILL_LOCATION.C_DI_XMM_REG],
        ],
      },
      decisionsHot: [],
      arguments: ["x66", "0xfffffffffffff"],
    };
    Paul.currentInstruction = c; // usually done in the instructionGeneration.ts
    const code = bitwiseOp(c);
    expect(getCurrentAllocations).toBeCalled();
    expect(allocate).toBeCalled();
    expect(code).toHaveLength(2);
    expect(code[0]).toMatch(/;.*/);
    expect(code[1]).toMatch(/bzhi r10, rbx, rax.*/);
    expect(zext).toBeCalled();
    expect(paulChooseAndSpy).toBeCalled();
  });
  it("should u64=u128 & imm64", () => {
    allocate.mockImplementation((req: AllocationReq) => {
      const [oReg0 /*lo*/, oReg1 /*hi*/] = req.oReg;
      const [in0, in1, in2] = req.in;
      expect(oReg0).toEqual("x67");
      expect(oReg1).toEqual(undefined);
      expect(in0).toEqual("x66_0");
      expect(in1).toEqual("0xfffffffffffff");
      expect(in2).toEqual(undefined);

      expect(req.allocationFlags).toBeTruthy();
      expect(req.allocationFlags! & AllocationFlags.DISALLOW_IMM).toBeTruthy();
      expect(req.allocationFlags! & AllocationFlags.IN_0_AS_OUT_REGISTER).toBeTruthy();
      expect(req.allocationFlags! & AllocationFlags.SAVE_FLAG_OF).toBeTruthy();
      expect(req.allocationFlags! & AllocationFlags.SAVE_FLAG_CF).toBeTruthy();

      return {
        oReg: [Register.r10],
        in: [Register.rbx, Register.rax],
      };
    });
    getCurrentAllocations.mockImplementation(() => {
      return {
        x66_0: { datatype: "u64", store: "rbx" },
        x66_1: { datatype: "u64", store: "r9" },
        x66: { datatype: "u128" },
      } as Allocations;
    });

    // this instruction could deliberately choose to delete x66_1, but I think the entire x66 will be deleted anyhow. lets see, if this will be an issue later on (to have deps on x66_0, but not on x66_1, thus x66_1 wouldnt be deleted cus not all x66-limbs are not used anymore, but x66_1 could..).
    const c: CryptOpt.StringOperation = {
      name: ["x67"],
      datatype: "u64",
      operation: "&",
      decisions: {
        [DECISION_IDENTIFIER.DI_CHOOSE_ARG]: [1, ["x66", "0xfffffffffffff"]],
        [DECISION_IDENTIFIER.DI_SPILL_LOCATION]: [
          0,
          [C_DI_SPILL_LOCATION.C_DI_MEM, C_DI_SPILL_LOCATION.C_DI_XMM_REG],
        ],
      },
      decisionsHot: [],
      arguments: ["x66", "0xfffffffffffff"],
    };
    Paul.currentInstruction = c; // usually done in the instructionGeneration.ts
    const code = bitwiseOp(c);
    expect(getCurrentAllocations).toBeCalled();
    expect(allocate).toBeCalled();
    expect(code).toHaveLength(1);
    expect(code[0]).toMatch(/and r10, rax.*/);
    expect(zext).toBeCalled();
  });
  it("should use AND, if the mask is allocated already, regardless of decision+Paul", () => {
    const bitmask = "0xfffffffffffff";
    allocate.mockImplementation((req: AllocationReq) => {
      const [oReg0] = req.oReg;
      const [in0, in1] = req.in;
      expect(req.oReg).toHaveLength(1);
      expect(oReg0).toEqual("x68");

      expect(req.in).toHaveLength(2);
      expect(in0).toEqual("x65");
      expect(in1).toEqual(bitmask);

      expect(req.allocationFlags).toBeTruthy();
      expect(req.allocationFlags! & AllocationFlags.DISALLOW_IMM).toBeTruthy();
      expect(req.allocationFlags! & AllocationFlags.IN_0_AS_OUT_REGISTER).toBeTruthy();
      expect(req.allocationFlags! & AllocationFlags.SAVE_FLAG_OF).toBeTruthy();
      expect(req.allocationFlags! & AllocationFlags.SAVE_FLAG_CF).toBeTruthy();

      return {
        oReg: [Register.r10],
        in: [Register.rbx, Register.rax],
      };
    });
    getCurrentAllocations.mockImplementation(() => {
      return {
        x65: { datatype: "u64", store: "rbx" },
        [bitmask]: { datatype: "u64", store: "rax" },
      } as Allocations;
    });

    const c: CryptOpt.StringOperation = {
      name: ["x68"],
      datatype: "u64",
      operation: "&",
      decisions: {
        [DECISION_IDENTIFIER.DI_INSTRUCTION_AND]: [
          1, //<---------------------------------------------note how this points to bzhi
          [C_DI_INSTRUCTION_AND.C_AND, C_DI_INSTRUCTION_AND.C_BZHI],
        ],
        di_choose_arg: [1, ["x65", bitmask]],
        [DECISION_IDENTIFIER.DI_SPILL_LOCATION]: [
          0,
          [C_DI_SPILL_LOCATION.C_DI_MEM, C_DI_SPILL_LOCATION.C_DI_XMM_REG],
        ],
      },
      decisionsHot: [],
      arguments: ["x65", bitmask],
    };
    Paul.currentInstruction = c; // usually done in the instructionGeneration.ts
    const code = bitwiseOp(c);
    expect(getCurrentAllocations).toBeCalled();
    expect(allocate).toBeCalled();
    expect(code).toHaveLength(2);
    expect(code[0]).toMatch(/;.*/);
    expect(code[1]).toMatch(/and r10, rax.*/);
    expect(paulChooseAndSpy).not.toBeCalled();
  });
  it("should use BZHI if the LSB  is allocated already, regardless of decision+Paul", () => {
    const bitmask = "0xfffffffffffff";
    const bits = LSB_MAPPING[bitmask];
    allocate.mockImplementation((req: AllocationReq) => {
      const [oReg0] = req.oReg;
      const [in0, in1] = req.in;
      expect(req.oReg).toHaveLength(1);
      expect(oReg0).toEqual("x68");

      expect(req.in).toHaveLength(2);
      expect(in0).toEqual("x65");
      expect(in1).toEqual(bits);

      expect(req.allocationFlags).toBeTruthy();
      expect(req.allocationFlags! & AllocationFlags.DISALLOW_IMM).toBeTruthy();
      expect(req.allocationFlags! & AllocationFlags.IN_0_AS_OUT_REGISTER).toBeFalsy();
      expect(req.allocationFlags! & AllocationFlags.SAVE_FLAG_OF).toBeTruthy();
      expect(req.allocationFlags! & AllocationFlags.SAVE_FLAG_CF).toBeTruthy();

      return {
        oReg: [Register.r10],
        in: [Register.rbx, Register.rax],
      };
    });
    getCurrentAllocations.mockImplementation(() => {
      return {
        x65: { datatype: "u64", store: "rbx" },
        [bits]: { datatype: "u64", store: "rax" }, //<<<<----------bits are allocated already
      } as Allocations;
    });

    const c: CryptOpt.StringOperation = {
      name: ["x68"],
      datatype: "u64",
      operation: "&",
      decisions: {
        [DECISION_IDENTIFIER.DI_INSTRUCTION_AND]: [
          0, //<---------------------------------------------note how this points to AND
          [C_DI_INSTRUCTION_AND.C_AND, C_DI_INSTRUCTION_AND.C_BZHI],
        ],
        di_choose_arg: [1, ["x65", bitmask]],
        [DECISION_IDENTIFIER.DI_SPILL_LOCATION]: [
          0,
          [C_DI_SPILL_LOCATION.C_DI_MEM, C_DI_SPILL_LOCATION.C_DI_XMM_REG],
        ],
      },
      decisionsHot: [],
      arguments: ["x65", bitmask],
    };
    Paul.currentInstruction = c; // usually done in the instructionGeneration.ts
    const code = bitwiseOp(c);
    expect(getCurrentAllocations).toBeCalled();
    expect(allocate).toBeCalled();
    expect(code).toHaveLength(2);
    expect(code[0]).toMatch(/;.*/);
    expect(code[1]).toMatch(/bzhi r10, rbx, rax.*/);
    expect(paulChooseAndSpy).not.toBeCalled();
  });
  it("should use SAME_SIZE_READ, for the case that one arg is not rm/64 ", () => {
    allocate.mockImplementation((req: AllocationReq) => {
      const [oReg0] = req.oReg;
      const [in0, in1] = req.in;
      expect(req.oReg).toHaveLength(1);
      expect(oReg0).toEqual("x68");

      expect(req.in).toHaveLength(2);
      expect(in0).toEqual("x65");
      expect(in1).toEqual("x66");
      expect(req.allocationFlags).toBeTruthy();
      expect(req.allocationFlags! & AllocationFlags.SAME_SIZE_READ).toBeTruthy();

      return {
        oReg: [Register.r10],
        in: [Register.rax, ByteRegister.bl],
      };
    });
    getCurrentAllocations.mockImplementation(() => {
      return {
        x65: { datatype: "u64", store: "rax" },
        x66: { datatype: "u8", store: "bl" },
      } as Allocations;
    });

    const c: CryptOpt.StringOperation = {
      name: ["x68"],
      datatype: "u64",
      operation: "&",
      decisions: {
        di_choose_arg: [1, ["x65", "x66"]],
        [DECISION_IDENTIFIER.DI_SPILL_LOCATION]: [
          0,
          [C_DI_SPILL_LOCATION.C_DI_MEM, C_DI_SPILL_LOCATION.C_DI_XMM_REG],
        ],
      },
      decisionsHot: [],
      arguments: ["x65", "x66"],
    };
    bitwiseOp(c);
    expect(getCurrentAllocations).toBeCalled();
    expect(allocate).toBeCalled();
  });
  it("should call declareDatatypeForVar, if  all args were u1 -> result is u1, too ", () => {
    allocate.mockImplementation((req: AllocationReq) => {
      const [oReg0] = req.oReg;
      const [in0, in1] = req.in;
      expect(req.oReg).toHaveLength(1);
      expect(oReg0).toEqual("x68");

      expect(req.in).toHaveLength(2);
      expect(in0).toEqual("x65");
      expect(in1).toEqual("x66");
      expect(req.allocationFlags).toBeTruthy();
      expect(req.allocationFlags! & AllocationFlags.SAME_SIZE_READ).toBeTruthy();

      return {
        oReg: [Register.r10],
        in: [ByteRegister.al, ByteRegister.bl],
      };
    });
    getCurrentAllocations.mockImplementation(() => {
      return {
        x65: { datatype: "u1", store: "al" },
        x66: { datatype: "u1", store: "bl" },
      } as Allocations;
    });

    const c: CryptOpt.StringOperation = {
      name: ["x68"],
      datatype: "u64",
      operation: "&",
      decisions: {
        di_choose_arg: [1, ["x65", "x66"]],
        [DECISION_IDENTIFIER.DI_SPILL_LOCATION]: [
          0,
          [C_DI_SPILL_LOCATION.C_DI_MEM, C_DI_SPILL_LOCATION.C_DI_XMM_REG],
        ],
      },
      decisionsHot: [],
      arguments: ["x65", "x66"],
    };
    const code = bitwiseOp(c);
    expect(code).toHaveLength(1);
    expect(code[0]).toMatch(/and r10b, bl.*/);
    expect(getCurrentAllocations).toBeCalled();
    expect(allocate).toBeCalled();
    expect(declareDatatypeForVar).toBeCalledWith("x68", "u1");
  });
  it("should lazyMov low limb if the AND is 128bit with 0xffffffffffffffff", () => {
    getCurrentAllocations.mockImplementation(() => {
      return {
        x131: { datatype: "u128" },
        x131_0: { datatype: "u64", store: Register.r10 },
        x131_1: { datatype: "u64", store: Register.r11 },
      } as Allocations;
    });

    const c: CryptOpt.StringOperation = {
      name: ["x132"],
      datatype: "u64",
      operation: "&",
      decisions: {
        di_choose_arg: [1, ["x131", "0xffffffffffffffff"]],
        [DECISION_IDENTIFIER.DI_SPILL_LOCATION]: [
          0,
          [C_DI_SPILL_LOCATION.C_DI_MEM, C_DI_SPILL_LOCATION.C_DI_XMM_REG],
        ],
      },
      decisionsHot: [],
      arguments: ["x131", "0xffffffffffffffff"],
    };
    const code = bitwiseOp(c);
    expect(code).toHaveLength(1);
    expect(getCurrentAllocations).toBeCalled();
    expect(lazyMov).toBeCalledWith(`${c.arguments[0]}_0`, c.name[0]);
    expect(code[0]).toMatch(/;.*/);
  });
  it("should lazyMov if the AND is 64bit with 0xffffffffffffffff (64bits)", () => {
    getCurrentAllocations.mockImplementation(() => {
      return {
        x131: { datatype: "u64", store: Register.r11 },
      } as Allocations;
    });

    const c: CryptOpt.StringOperation = {
      name: ["x132"],
      datatype: "u64",
      operation: "&",
      decisions: {
        di_choose_arg: [1, ["x131", "0xffffffffffffffff"]],
        [DECISION_IDENTIFIER.DI_SPILL_LOCATION]: [
          0,
          [C_DI_SPILL_LOCATION.C_DI_MEM, C_DI_SPILL_LOCATION.C_DI_XMM_REG],
        ],
      },
      decisionsHot: [],
      arguments: ["x131", "0xffffffffffffffff"],
    };
    const code = bitwiseOp(c);
    expect(code).toHaveLength(1);
    expect(lazyMov).toBeCalledWith(c.arguments[0], c.name[0]);
    expect(getCurrentAllocations).toBeCalled();
    expect(code[0]).toMatch(/;.*/);
  });
});
