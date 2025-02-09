# First steps

## Understand Output

While optimizing, CryptOpt will output the current status of the optimization.
Each line has this format:
```
fiat_curve25519_carry_square|1/10| 14|bs  181|#inst: 140|cyclΔ     70|G  58 cycl σ  0|B  59 cycl σ  0|L  55|l/g 0.9519| P|P[ -14/   0/  14/ -11]|D[MU/  1/ 31/ 59]| 90.0( 1%)  60/s
```
Lets break this down:

Field                 |Example    | Comment
--|--|--
Symbol                | `fiat_curve25519_carry_square`	| The symbol being optimized.
Comment               | 1/10                            | Arbitrary comment. Usually used in Bet-n-run mode. Then, it means bet `1` from `10`, after that it'll say `run`.
Stack size            | 14	                 	        | How many spills to memory there are. E.g. `6` for all spills of the six callee-saved registers
Batch Size            | bs  181		                    | `BS` in the paper, How big is the batch. i.e. how many iterations of *Symbol* are counted
Instr. Count          | #inst: 140		                | How many instructions are used to implement the *Symbol*
Raw Cycle Delta       | cyclΔ     70		            | Measure both batches `nob=31` times, take difference of medians. (This is that delta). Based on this a mutation is kept or not.
Cycles +stddev (good) | G  58 cycl σ  0		            | Number of cycles for the `good` candidate, scaled by `bs` i.e. per on *one* iteration. Also states the stdDev of the `nob` measurements
Cycles +stddev (bad)  | B  59 cycl σ  0		            | Same, but for the `bad` candidate
Cycles Library        | L  55		                    | Cycles that the CC-Compiled version takes
Ratio                 | l/g 0.9519                      | Ratio of cycles lib / cycles good. i.e. 55 / 58 -> 0.9519 (uses the non-scaled counts) This is green if the ratio is `>1` which means that CryptOpt Code is faster than CC's.
Mutation              |  P		                        | Which mutation has been applied. **P**ermuation or **D**ecision. (Permutation means mutation in operation order; Decision means which template to use, or how to load operands.)
P-Mutation-Detail     | P[ -14/   0/  14/ -11]          | Details on last P-Mutation. [steps to go back / steps to go forward / absolute index of operation to move / applied relative movement ]
D-Mutation-Detail     | D[MU/  1/ 31/ 59]		        | Details on last D-Mutation. [new chosen template / absolute index of operation to change decision / number of operations with changeable decisions / number of operations with decisions]
Progress, speed       |  90.0( 1%)  60/s                | Number of the current Mutation, then in Percent, then how many mutations per second can be evaluated. This is green if the mutation is kept.

More on the *D-Mutation*-Details:

Template Short | Description
--|--
AR | A different argument is loaded from memory
KK | The flags `CF`/ `OF` flags are cleared differently
FL | A different flag `CF`/ `OF` is used as an accumulator
B& | For a binary-and a different instruction-template is used
MU | For a multiplication-with-immediate a different instruction-template is used
IM | A different immediate value is loaded
SL | Spill location changed spill-to-memory <-> spill-to-xmm


## Understand Output Files

While Optimizing, CryptOpt will generate files in the `./results/<BRIDGE>/<SYMBOL>` folder (adjustable with `--resultDir` parameter to `./CryptOpt`).

CryptOpt writes out intermediate ASM-files whenever *it finishes a bet* and an additional file when finished the *run*.
CryptOpt also generates the internal state (in `*.json` files) of the optimization for each *bet*-outcome.
The directory also contains a `*.dat` (space separated) file with rows for every bet/run containing the `l/g` value every time it is printed to the terminal.
From that `*.dat` file, the generated `*.gp` file will generate the `*.pdf` file, which shows the optimization in progress.
Additionally, (currently WIP) there is a `*.csv` file logging all the mutations and which ones were kept.

## Play around w/ Fiat

We can give CryptOpt a wide range of parameters:

Parameter    | default     | possible / typical values | description
-------------|-------------|---------------------------|----------
--bridge     | fiat        | fiat, bitcoin-core, manual| which *connection* i.e. input should be used.
--evals      | 10000       | 100, 1k, 100k, 1M         | `t`; How many mutations to evaluate
--curve      | curve25519  | curve25519, p224, p256, p384, p434, p448\_solinas, p521, poly1305, secp256k1 | which field - this determines the prime, the implementation strategy and number of limbs
--method     | square      | mul, square               | Method (i.e. function) to optimize. Multiply or Square
--cyclegoal  | 10000       | 1, 100, 100000            | How many cycles to measure, and adjust batch size `bs` accordingly
--bets       | 10          | 10, 30, 100               | How many 'bets' for the bet-and-run heuristic
--betRatio   | 0.2         | 0.1, 0.3                  | The share from parameter `--evals`, which are spent for all bets, in per cent (i.e. 0.2 means 20% of --evals will be used for the bet part, and 80% for the final run-part)
--resultDir  | ./results   | /tmp/myresults            | The directory under which `<BRIDGE>/<SYMBOL>` will be created and the result files will be stored
--no-proof   |             | --no-proof, --proof       | [dis\|en]ables the Fiat-Proofing system. It is enabled by default for `fiat`-bridge, disabled for the rest.
--memoryConstraints| none  | none, all, out1-arg1      | none: any argN[n] can be read after any outN[n] as been written. That is okay, if all memoy is distinct. 'out1-arg1' specifies that arg1[n] cannnot be read, if out1[n] has been written. It may read arg1[n+m] after out1[n] has been written. Use that if you want to call `mul(r,r,x)` or `sq(a,a)`. all: no argN[n] can be read if any outN[n] has been written. Use that if memory can be overlapping and unaligned.

For more information check `./CryptOpt --help`

As next example, use `CC=clang ./CryptOpt --curve p256 --method mul --evals 10k` to generate an optimized version for NIST P-256 multiply and compare the function with `clang`-compiled version of the C-equivalent.

## Play around w/ Bitcoin

1. Run `./CryptOpt --bridge bitcoin-core --curve secp256k1 --method mul --bets 5`  
This will try 5 different *bets* for the primitive *mul* of *libsecp256k1*.

1. Find the result files (`*.asm`,`*.pdf`) for this run in `./results/bitcoin-core/secp256k1_fe_mul_inner/`
