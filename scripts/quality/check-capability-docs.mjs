import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { pathToFileURL } from 'node:url';

export const CURRENT_CAPABILITY_DOCUMENTS = {
  'docs/product-design.md': ['21'],
  'docs/data-model.md': ['40.10'],
  'docs/agent-runtime.md': ['12'],
  'docs/architecture/conversational-creative-workbench.md': ['1', '11', '13', '14.5'],
  'docs/technical/testing.md': ['2.24'],
};

function sections(content, numbers) {
  const headings = [
    ...content.matchAll(/^(#{1,6})\s+(\d+(?:\.\d+)*)(?:\.(?=\s)|(?=\s))[^\r\n]*/gmu),
  ];
  return numbers
    .map((number) => {
      const index = headings.findIndex((heading) => heading[2] === number);
      if (index < 0) throw new Error(`Missing current capability section ${number}.`);
      const next = headings
        .slice(index + 1)
        .find((heading) => heading[1].length <= headings[index][1].length);
      return content.slice(headings[index].index, next?.index ?? content.length);
    })
    .join('\n');
}

export function checkCapabilityDeclarations({ manifest, hostSource, documents }) {
  const visible = manifest.modelVisibleToolIdentities;
  if (!Array.isArray(visible) || !visible.length || new Set(visible).size !== visible.length)
    throw new Error('Invalid model-visible manifest identities.');
  const expected = [...visible].sort();
  for (const identity of expected) {
    const matching = manifest.tools.filter((tool) => `${tool.id}@${tool.version}` === identity);
    if (
      matching.length !== 1 ||
      matching[0].exposure !== 'stable' ||
      matching[0].health !== 'working' ||
      matching[0].sideEffect !== 'none'
    ) {
      throw new Error(`Manifest identity is not stable, working and read-only: ${identity}`);
    }
  }
  const allowlist = hostSource
    .match(/const CANONICAL_ALLOWED_TOOLS:\s*&str\s*=\s*"([^"]+)"/u)?.[1]
    .split(',')
    .sort();
  if (
    JSON.stringify(allowlist) !==
      JSON.stringify(expected.map((identity) => identity.split('@')[0]).sort()) ||
    !/fn turn_allowed_tools\([^]*?if is_canonical_only_turn\(input\)\s*\{\s*CANONICAL_ALLOWED_TOOLS\s*\}\s*else\s*\{\s*ALLOWED_TOOLS/u.test(
      hostSource,
    ) ||
    !/fn is_canonical_only_turn\([^]*?input\.task_kind\s*==\s*"read"/u.test(hostSource)
  ) {
    throw new Error(
      'Host Canonical read allowlist disagrees with current capability declarations.',
    );
  }
  for (const [file, sectionNumbers] of Object.entries(CURRENT_CAPABILITY_DOCUMENTS)) {
    const content = documents[file];
    if (typeof content !== 'string') throw new Error(`Missing capability document: ${file}`);
    const blocks = [
      ...content.matchAll(
        /<!-- ans-current-canonical:start -->([\s\S]*?)<!-- ans-current-canonical:end -->/gu,
      ),
    ];
    if (blocks.length !== 1) throw new Error(`Expected one current capability fact block: ${file}`);
    const block = blocks[0][1];
    const identities = [...block.matchAll(/`([a-z][a-z._]+@\d+)`/gu)]
      .map((match) => match[1])
      .sort();
    if (
      JSON.stringify(identities) !== JSON.stringify(expected) ||
      !['`canonical-only`', '`deterministic-writer`', '`NOT_VERIFIED`'].every((fact) =>
        block.includes(fact),
      )
    ) {
      throw new Error(
        `Current capability fact block drifted from manifest or evidence boundary: ${file}`,
      );
    }
    const current = sections(content, sectionNumbers).replaceAll('`', '');
    for (const line of current.split(/\r?\n/u)) {
      // Explicit historical or negative examples remain readable; they are not current assertions.
      if (/历史基线|历史状态|当时|不得再把|不能写成|禁止声称|不得宣称|不是当前状态/u.test(line))
        continue;
      if (
        /modelVisibleToolIdentities\s*(?:=\s*\[\s*\]|(?:的)?(?:长度|数量)?\s*(?:为|是|=)\s*0)|模型可见(?:工具)?(?:数|数量)\s*(?:为|是|=)\s*0/u.test(
          line,
        ) ||
        /(?:仍是|仍为|保持为?)\s*catalog_only/u.test(line) ||
        /宿主[^。\n]*(?:仍|尚未)[^。\n]*(?:注入|固定)[^。\n]*legacy|生产[^。\n]*(?:尚未切|仍见 legacy)/u.test(
          line,
        ) ||
        /(?:live|云端)[^。\n]*(?:已(?:通过|完成)(?:真实)?(?:验收|验证)|已\s*VERIFIED|为\s*VERIFIED)/u.test(
          line,
        )
      ) {
        throw new Error(`Contradictory current capability prose: ${file}`);
      }
    }
  }
  return expected.length;
}

export async function checkWorkspaceCapabilityDocs(root) {
  const read = (file) => readFile(path.join(root, file), 'utf8');
  const documents = Object.fromEntries(
    await Promise.all(
      Object.keys(CURRENT_CAPABILITY_DOCUMENTS).map(async (file) => [file, await read(file)]),
    ),
  );
  return checkCapabilityDeclarations({
    documents,
    manifest: JSON.parse(await read('contracts/agent/canonical-tool-manifest.v1.json')),
    hostSource: await read('src-tauri/src/services/dsh/task_runtime.rs'),
  });
}

if (process.argv[1] && import.meta.url === pathToFileURL(path.resolve(process.argv[1])).href) {
  try {
    console.log(
      `Capability declarations agree with ${await checkWorkspaceCapabilityDocs(process.cwd())} Canonical read tools; live Provider remains NOT_VERIFIED.`,
    );
  } catch (error) {
    console.error(error.message);
    process.exitCode = 1;
  }
}
