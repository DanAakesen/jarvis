import { pathToFileURL } from 'node:url';
import { generateBundle, VARIANTS } from './generate.js';
import { validateBundle } from './validate.js';

export const CLI_FLAGS = ['--help', '--bundle', '--seed', '--variant', '--rows', '--report-dir', '--now', '--memory-budget-bytes'] as const;
export const HELP = `Temporary offline Daily migration tooling (synthetic generation / validation only).
generate --bundle PATH --seed INTEGER [--variant NAME] [--rows N]
validate --bundle PATH --report-dir PATH [--now ISO_TIMESTAMP] [--memory-budget-bytes N]
--help
Variants: ${VARIANTS.join(', ')}
No SQL, network, import, activation or source access. Output never includes supplied paths or values.
`;

export async function main(args: string[], output: (text: string) => void = text => process.stdout.write(text)): Promise<number> {
  try {
    if ((args.length === 1 && args[0] === '--help')
      || (args.length === 2 && ['generate', 'validate'].includes(args[0]!) && args[1] === '--help')) { output(HELP); return 0; }
    const command = args[0];
    if (command !== 'generate' && command !== 'validate') { output('cli-invalid-arguments\n'); return 2; }
    const values: Record<string, string> = {};
    const allowed = command === 'generate' ? ['--bundle', '--seed', '--variant', '--rows']
      : ['--bundle', '--report-dir', '--now', '--memory-budget-bytes'];
    for (let i = 1; i < args.length; i += 2) {
      const flag = args[i], value = args[i + 1];
      if (!flag || !allowed.includes(flag) || Object.hasOwn(values, flag) || !value || value.startsWith('--')) {
        output('cli-invalid-arguments\n'); return 2;
      }
      values[flag] = value;
    }
    if (!values['--bundle'] || (command === 'generate' ? values['--seed'] === undefined : !values['--report-dir'])) {
      output('cli-invalid-arguments\n'); return 2;
    }
    const number = (flag: string): number | undefined => {
      const value = values[flag];
      if (value === undefined) return undefined;
      if (!/^-?\d+$/.test(value) || !Number.isSafeInteger(Number(value))) throw new Error();
      return Number(value);
    };
    if (command === 'generate') {
      await generateBundle({ bundle: values['--bundle'], seed: number('--seed')!, variant: values['--variant'], rows: number('--rows') });
      output('synthetic-bundle-created\n'); return 0;
    }
    const report = await validateBundle({
      bundle: values['--bundle'], reportDir: values['--report-dir']!,
      now: values['--now'], memoryBudgetBytes: number('--memory-budget-bytes'),
    });
    output(report.valid ? 'validation-passed\n' : 'validation-failed\n');
    return report.valid ? 0 : 1;
  } catch { output('operation-failed\n'); return 2; }
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  process.exitCode = await main(process.argv.slice(2));
}
