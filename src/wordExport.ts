import {
  AlignmentType,
  Document,
  HeadingLevel,
  LevelFormat,
  LineRuleType,
  Packer,
  Paragraph,
  TextRun,
} from "docx";

export type ExportRichNode = {
  type?: string;
  text?: string;
  attrs?: Record<string, unknown>;
  marks?: Array<{ type?: string }>;
  content?: ExportRichNode[];
};

export type ExportRichDocument = ExportRichNode;

export type ExportChapterInput = {
  id: string;
  title: string;
  parent_id: string | null;
  sort_order: number;
  content: string;
  created_at: string;
};

export type ExportPointInput = {
  id: string;
  title: string;
  status?: string;
};

export type ExportPlacementInput = {
  id: string;
  knowledge_point_id: string;
  chapter_id: string;
  sort_order: number;
  chapter_note: ExportRichDocument;
  created_at: string;
};

export type ExportContentInput = {
  explanation: ExportRichDocument;
  exercises: ExportRichDocument;
  supplement: ExportRichDocument;
  inspiration: ExportRichDocument;
};

export type ExportTreeInput = {
  chapters: ExportChapterInput[];
  knowledge_points: ExportPointInput[];
  knowledge_point_placements: ExportPlacementInput[];
};

export type ExportPointModel = {
  id: string;
  placementId: string;
  title: string;
  content: ExportContentInput;
  chapterNote: ExportRichDocument;
  contextPath?: string;
};

export type ExportChapterModel = {
  id: string;
  title: string;
  overview: string;
  level: number;
  points: ExportPointModel[];
  children: ExportChapterModel[];
};

export type ExportDocumentModel = {
  kind: "knowledge_point" | "chapter" | "combined";
  title: string;
  chapters?: ExportChapterModel[];
  points?: ExportPointModel[];
};

export type ExportSelection = {
  placementId: string;
  knowledgePointId: string;
  chapterId: string;
  title: string;
  path: string;
};

const EMPTY_DOCUMENT: ExportRichDocument = { type: "doc", content: [{ type: "paragraph" }] };
const FONT_MAP = { ascii: "Times New Roman", hAnsi: "Times New Roman", eastAsia: "宋体", cs: "Times New Roman" };
const BODY_SIZE = 24;
const BODY_LINE = 300;
const BODY_AFTER = 120;
const A4_WIDTH = 11906;
const A4_HEIGHT = 16838;
const MARGIN = 1440;

const SECTION_LABELS = [
  ["explanation", "知识讲解"],
  ["exercises", "例题练习"],
  ["supplement", "补充内容"],
  ["inspiration", "💡 灵感"],
] as const;

function normaliseDocument(value: ExportRichDocument | null | undefined): ExportRichDocument {
  return value && value.type === "doc" ? value : EMPTY_DOCUMENT;
}

function nodeHasText(node: ExportRichNode | null | undefined): boolean {
  if (!node) return false;
  if (typeof node.text === "string" && node.text.trim()) return true;
  return Array.isArray(node.content) && node.content.some((child) => nodeHasText(child));
}

function richDocumentHasText(value: ExportRichDocument | null | undefined) {
  return nodeHasText(value);
}

function sortByOrder<T extends { sort_order: number; created_at: string }>(items: T[]) {
  return [...items].sort((left, right) => left.sort_order - right.sort_order || left.created_at.localeCompare(right.created_at));
}

function plainTextParagraphs(value: string): Paragraph[] {
  return value
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter(Boolean)
    .map((line) => new Paragraph({ style: "ExportBody", children: [new TextRun({ text: line, font: FONT_MAP, size: BODY_SIZE })] }));
}

function pointModel(
  point: ExportPointInput,
  placement: ExportPlacementInput,
  content: ExportContentInput | null | undefined,
  contextPath?: string,
): ExportPointModel {
  return {
    id: point.id,
    placementId: placement.id,
    title: point.title,
    content: content ?? { explanation: EMPTY_DOCUMENT, exercises: EMPTY_DOCUMENT, supplement: EMPTY_DOCUMENT, inspiration: EMPTY_DOCUMENT },
    chapterNote: normaliseDocument(placement.chapter_note),
    contextPath,
  };
}

export function buildKnowledgePointExportModel(
  point: ExportPointInput,
  placement: ExportPlacementInput,
  content: ExportContentInput | null | undefined,
): ExportDocumentModel {
  return { kind: "knowledge_point", title: point.title, points: [pointModel(point, placement, content)] };
}

export function buildCombinedExportModel(
  selections: ExportSelection[],
  tree: ExportTreeInput,
  contents: ReadonlyMap<string, ExportContentInput | null>,
): ExportDocumentModel {
  const pointMap = new Map(tree.knowledge_points.map((point) => [point.id, point]));
  const placementMap = new Map(tree.knowledge_point_placements.map((placement) => [placement.id, placement]));
  const chapterMap = new Map(tree.chapters.map((chapter) => [chapter.id, chapter]));
  const points = selections.map((selection) => {
    const point = pointMap.get(selection.knowledgePointId);
    const placement = placementMap.get(selection.placementId);
    if (!point || !placement || !chapterMap.has(selection.chapterId)) throw new Error("导出的知识点已发生变化，请重新选择后再试。");
    return pointModel(point, placement, contents.get(point.id), selection.path);
  });
  return { kind: "combined", title: "英语讲义", points };
}

export function buildChapterExportModel(
  rootId: string,
  tree: ExportTreeInput,
  contents: ReadonlyMap<string, ExportContentInput | null>,
): ExportDocumentModel {
  const chapterMap = new Map(tree.chapters.map((chapter) => [chapter.id, chapter]));
  const pointMap = new Map(tree.knowledge_points.map((point) => [point.id, point]));
  const childrenByParent = new Map<string | null, ExportChapterInput[]>();
  for (const chapter of tree.chapters) {
    const children = childrenByParent.get(chapter.parent_id) ?? [];
    children.push(chapter);
    childrenByParent.set(chapter.parent_id, children);
  }
  const placementsByChapter = new Map<string, ExportPlacementInput[]>();
  for (const placement of tree.knowledge_point_placements) {
    const placements = placementsByChapter.get(placement.chapter_id) ?? [];
    placements.push(placement);
    placementsByChapter.set(placement.chapter_id, placements);
  }

  const buildNode = (chapter: ExportChapterInput, level: number): ExportChapterModel => {
    const points = sortByOrder(placementsByChapter.get(chapter.id) ?? [])
      .map((placement) => {
        const point = pointMap.get(placement.knowledge_point_id);
        return point ? pointModel(point, placement, contents.get(point.id)) : null;
      })
      .filter((point): point is ExportPointModel => Boolean(point));
    const children = sortByOrder(childrenByParent.get(chapter.id) ?? [])
      .map((child) => buildNode(child, Math.min(level + 1, 4)))
      .filter((child) => Boolean(child.overview.trim()) || child.points.length > 0 || child.children.length > 0);
    return { id: chapter.id, title: chapter.title, overview: chapter.content ?? "", level, points, children };
  };

  const root = chapterMap.get(rootId);
  if (!root) throw new Error("章节不存在或已移入回收站。");
  return { kind: "chapter", title: root.title, chapters: [buildNode(root, 1)] };
}

function textRun(text: string, marks: Set<string>) {
  return new TextRun({
    text,
    font: FONT_MAP,
    size: BODY_SIZE,
    bold: marks.has("bold"),
    italics: marks.has("italic"),
  });
}

function inlineRuns(nodes: ExportRichNode[] = [], inheritedMarks = new Set<string>()): TextRun[] {
  const runs: TextRun[] = [];
  for (const node of nodes) {
    const marks = new Set(inheritedMarks);
    for (const mark of node.marks ?? []) if (mark.type) marks.add(mark.type);
    if (node.type === "text" && typeof node.text === "string") runs.push(textRun(node.text, marks));
    else if (node.type === "hardBreak") runs.push(new TextRun({ break: 1, font: FONT_MAP, size: BODY_SIZE }));
    else if (node.content) runs.push(...inlineRuns(node.content, marks));
  }
  return runs;
}

function listParagraphs(node: ExportRichNode, reference: string, level: number): Paragraph[] {
  const paragraphs: Paragraph[] = [];
  for (const item of node.content ?? []) {
    if (item.type === "listItem") {
      const blocks = item.content ?? [];
      const firstBlock = blocks.find((block) => block.type === "paragraph" || block.type === "heading");
      const runs = firstBlock ? inlineRuns(firstBlock.content) : [];
      paragraphs.push(new Paragraph({
        style: "ExportBody",
        numbering: { reference, level },
        children: runs.length > 0 ? runs : [new TextRun({ text: "", font: FONT_MAP, size: BODY_SIZE })],
      }));
      for (const block of blocks) {
        if (block.type === "bulletList") paragraphs.push(...listParagraphs(block, "HandoutBullets", Math.min(level + 1, 3)));
        if (block.type === "orderedList") paragraphs.push(...listParagraphs(block, "HandoutNumbers", Math.min(level + 1, 3)));
      }
    }
  }
  return paragraphs;
}

function richDocumentToParagraphs(value: ExportRichDocument | null | undefined): Paragraph[] {
  const document = normaliseDocument(value);
  if (!richDocumentHasText(document)) return [];
  const paragraphs: Paragraph[] = [];
  for (const node of document.content ?? []) {
    if (node.type === "paragraph") {
      const runs = inlineRuns(node.content);
      paragraphs.push(new Paragraph({ style: "ExportBody", children: runs.length > 0 ? runs : [new TextRun({ text: "", font: FONT_MAP, size: BODY_SIZE })] }));
    } else if (node.type === "heading") {
      const level = Math.max(2, Math.min(4, Number(node.attrs?.level ?? 2)));
      const style = level === 2 ? "ExportInnerHeading2" : level === 3 ? "ExportInnerHeading3" : "ExportInnerHeading4";
      paragraphs.push(new Paragraph({ style, heading: level === 2 ? HeadingLevel.HEADING_2 : level === 3 ? HeadingLevel.HEADING_3 : HeadingLevel.HEADING_4, children: inlineRuns(node.content) }));
    } else if (node.type === "bulletList") {
      paragraphs.push(...listParagraphs(node, "HandoutBullets", 0));
    } else if (node.type === "orderedList") {
      paragraphs.push(...listParagraphs(node, "HandoutNumbers", 0));
    } else if (node.type === "blockquote") {
      for (const block of node.content ?? []) {
        const runs = inlineRuns(block.content);
        if (runs.length > 0) paragraphs.push(new Paragraph({ style: "ExportQuote", children: runs }));
      }
    }
  }
  return paragraphs;
}

function bodyHeading(text: string) {
  return new Paragraph({ style: "ExportSectionHeading", children: [new TextRun({ text, font: FONT_MAP, size: 30, bold: true })] });
}

function pointParagraphs(point: ExportPointModel, includeContext = false): Paragraph[] {
  const paragraphs: Paragraph[] = [new Paragraph({ style: "ExportPointHeading", heading: HeadingLevel.HEADING_2, children: [new TextRun({ text: point.title, font: FONT_MAP, size: 32, bold: true })] })];
  if (includeContext && point.contextPath) paragraphs.push(new Paragraph({ style: "ExportContext", children: [new TextRun({ text: point.contextPath, font: FONT_MAP, size: 20, color: "777777" })] }));
  for (const [field, label] of SECTION_LABELS) {
    const document = point.content[field];
    if (!richDocumentHasText(document)) continue;
    paragraphs.push(bodyHeading(label), ...richDocumentToParagraphs(document));
  }
  if (richDocumentHasText(point.chapterNote)) paragraphs.push(bodyHeading("本章补充"), ...richDocumentToParagraphs(point.chapterNote));
  return paragraphs;
}

function chapterParagraphs(chapter: ExportChapterModel, root: boolean, pageBreakBefore: boolean): Paragraph[] {
  const headingStyle = chapter.level === 1 ? "ExportChapterHeading1" : chapter.level === 2 ? "ExportChapterHeading2" : chapter.level === 3 ? "ExportChapterHeading3" : "ExportChapterHeading4";
  const heading = new Paragraph({
    style: headingStyle,
    heading: chapter.level === 1 ? HeadingLevel.HEADING_1 : chapter.level === 2 ? HeadingLevel.HEADING_2 : chapter.level === 3 ? HeadingLevel.HEADING_3 : HeadingLevel.HEADING_4,
    pageBreakBefore: pageBreakBefore && !root,
    children: [new TextRun({ text: chapter.title, font: FONT_MAP, size: chapter.level === 1 ? 36 : chapter.level === 2 ? 32 : chapter.level === 3 ? 30 : 28, bold: true })],
  });
  const paragraphs: Paragraph[] = [heading, ...plainTextParagraphs(chapter.overview)];
  for (const point of chapter.points) paragraphs.push(...pointParagraphs(point));
  for (const child of chapter.children) paragraphs.push(...chapterParagraphs(child, false, false));
  return paragraphs;
}

function exportStyles() {
  const body = { font: FONT_MAP, size: BODY_SIZE };
  const bodyParagraph = { spacing: { before: 0, after: BODY_AFTER, line: BODY_LINE, lineRule: LineRuleType.AUTO }, widowControl: true };
  return {
    default: { document: { run: body, paragraph: bodyParagraph } },
    paragraphStyles: [
      { id: "ExportBody", name: "讲义正文", basedOn: "Normal", next: "ExportBody", run: body, paragraph: bodyParagraph },
      { id: "ExportContext", name: "导出章节语境", basedOn: "Normal", run: { ...body, size: 20, color: "777777" }, paragraph: { spacing: { before: 0, after: 120, line: BODY_LINE, lineRule: LineRuleType.AUTO } } },
      { id: "ExportSectionHeading", name: "内容区标题", basedOn: "Normal", next: "ExportBody", run: { ...body, size: 30, bold: true }, paragraph: { spacing: { before: 180, after: 100, line: 320, lineRule: LineRuleType.AUTO, keepNext: true } } },
      { id: "ExportPointHeading", name: "知识点标题", basedOn: "Normal", next: "ExportBody", run: { ...body, size: 32, bold: true }, paragraph: { spacing: { before: 220, after: 180, line: 360, lineRule: LineRuleType.AUTO, keepNext: true } } },
      { id: "ExportChapterHeading1", name: "一级章节", basedOn: "Normal", next: "ExportBody", run: { ...body, size: 36, bold: true }, paragraph: { spacing: { before: 0, after: 220, line: 400, lineRule: LineRuleType.AUTO, keepNext: true } } },
      { id: "ExportChapterHeading2", name: "二级章节", basedOn: "Normal", next: "ExportBody", run: { ...body, size: 32, bold: true }, paragraph: { spacing: { before: 220, after: 160, line: 360, lineRule: LineRuleType.AUTO, keepNext: true } } },
      { id: "ExportChapterHeading3", name: "三级章节", basedOn: "Normal", next: "ExportBody", run: { ...body, size: 30, bold: true }, paragraph: { spacing: { before: 180, after: 140, line: 340, lineRule: LineRuleType.AUTO, keepNext: true } } },
      { id: "ExportChapterHeading4", name: "四级章节", basedOn: "Normal", next: "ExportBody", run: { ...body, size: 28, bold: true }, paragraph: { spacing: { before: 160, after: 120, line: 320, lineRule: LineRuleType.AUTO, keepNext: true } } },
      { id: "ExportInnerHeading2", name: "正文二级标题", basedOn: "Normal", next: "ExportBody", run: { ...body, size: 28, bold: true }, paragraph: { spacing: { before: 160, after: 100, line: 320, lineRule: LineRuleType.AUTO, keepNext: true } } },
      { id: "ExportInnerHeading3", name: "正文三级标题", basedOn: "Normal", next: "ExportBody", run: { ...body, size: 26, bold: true }, paragraph: { spacing: { before: 140, after: 90, line: 300, lineRule: LineRuleType.AUTO, keepNext: true } } },
      { id: "ExportInnerHeading4", name: "正文四级标题", basedOn: "Normal", next: "ExportBody", run: { ...body, size: 24, bold: true }, paragraph: { spacing: { before: 120, after: 80, line: 300, lineRule: LineRuleType.AUTO, keepNext: true } } },
      { id: "ExportQuote", name: "讲义引用", basedOn: "ExportBody", run: { ...body, italics: true, color: "555555" }, paragraph: { indent: { left: 480 }, spacing: { before: 0, after: BODY_AFTER, line: BODY_LINE, lineRule: LineRuleType.AUTO } } },
    ],
  };
}

function exportNumbering() {
  const levels = [0, 1, 2, 3];
  return {
    config: [
      {
        reference: "HandoutBullets",
        levels: levels.map((level) => ({ level, format: LevelFormat.BULLET, text: "•", alignment: AlignmentType.LEFT, style: { run: { font: FONT_MAP }, paragraph: { indent: { left: 720 + level * 360, hanging: 360 } } } })),
      },
      {
        reference: "HandoutNumbers",
        levels: levels.map((level) => ({ level, format: LevelFormat.DECIMAL, text: `%${level + 1}.`, alignment: AlignmentType.LEFT, style: { run: { font: FONT_MAP }, paragraph: { indent: { left: 720 + level * 360, hanging: 360 } } } })),
      },
    ],
  };
}

export async function createDocxBlob(model: ExportDocumentModel): Promise<Blob> {
  const children: Paragraph[] = [];
  if (model.kind === "chapter") {
    for (const [index, chapter] of (model.chapters ?? []).entries()) children.push(...chapterParagraphs(chapter, true, index > 0));
  } else {
    for (const point of model.points ?? []) children.push(...pointParagraphs(point, model.kind === "combined"));
  }
  const document = new Document({
    title: model.title,
    subject: "个人英语讲义",
    creator: "个人英语讲义工作台",
    description: "由个人英语讲义工作台即时生成的讲义文档。",
    styles: exportStyles(),
    numbering: exportNumbering(),
    sections: [{ properties: { page: { size: { width: A4_WIDTH, height: A4_HEIGHT }, margin: { top: MARGIN, right: MARGIN, bottom: MARGIN, left: MARGIN } } }, children }],
  });
  return Packer.toBlob(document);
}

export function safeDocxFilename(value: string, fallback = "英语讲义") {
  const safe = value.replace(/[\\/:*?"<>|]/g, "_").replace(/[. ]+$/g, "").trim();
  return `${safe || fallback}.docx`;
}

export function downloadDocx(blob: Blob, filename: string) {
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement("a");
  anchor.href = url;
  anchor.download = filename;
  anchor.rel = "noopener";
  document.body.appendChild(anchor);
  anchor.click();
  anchor.remove();
  window.setTimeout(() => URL.revokeObjectURL(url), 1000);
}
