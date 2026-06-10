import { createInterface } from "node:readline/promises";
import { stdin, stdout } from "node:process";

export const rl = createInterface({
  input: stdin,
  output: stdout,
});

export async function prompt(text: string) {
  return rl.question(text);
}

export async function promptRequired(text: string, errorMessage: string) {
  while (true) {
    const answer = (await prompt(text)).trim();
    if (answer) {
      return answer;
    }

    stdout.write(`${errorMessage}\n`);
  }
}

export async function promptPassword(label: string) {
  return prompt(label);
}

export async function pause(label = "Tekan Enter untuk lanjut...") {
  await prompt(label);
}

export function closeInput() {
  rl.close();
}
