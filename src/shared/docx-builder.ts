/**
 * DOCX 导出构建器 — 纯函数，把定稿章节打包成一份 Word 文档（Office Open XML）。
 *
 * 与 EPUB 一样手写 ZIP，不引入 docx/npm 依赖：OOXML 允许无压缩（stored）条目，
 * 正文几 MB 的压缩收益抵不过新增一个运行时依赖与它的供应链风险。
 * 输出是确定的：同一份输入与同一个 createdIso 得到字节相同的文件，便于测试与去重。
 */
import { buildStoredZip, escapeXmlText } from './epub-builder'
import { chapterHeadingText, proseParagraphs } from './prose-text'

export interface DocxChapterInput {
  chapterNumber: number
  title: string
  content: string
}

export interface DocxBuildInput {
  title: string
  author?: string
  /** BCP 47 语言标签，如 zh-CN / en-US；决定正文的东亚字体与校对语言。 */
  language: string
  chapters: readonly DocxChapterInput[]
  /** dcterms:created 需要的 UTC 时间（ISO 8601）。 */
  createdIso: string
}

const W_NS = 'http://schemas.openxmlformats.org/wordprocessingml/2006/main'
const REL_NS = 'http://schemas.openxmlformats.org/package/2006/relationships'
const OFFICE_REL = 'http://schemas.openxmlformats.org/officeDocument/2006/relationships'

const encoder = new TextEncoder()


function run(text: string): string {
  return `<w:r><w:t xml:space="preserve">${escapeXmlText(text)}</w:t></w:r>`
}

function paragraph(text: string, options: { style?: 'Title' | 'Heading1'; firstLineChars?: number } = {}): string {
  const properties: string[] = []
  if (options.style) properties.push(`<w:pStyle w:val="${options.style}"/>`)
  if (options.firstLineChars) properties.push(`<w:ind w:firstLineChars="${options.firstLineChars}"/>`)
  const pPr = properties.length > 0 ? `<w:pPr>${properties.join('')}</w:pPr>` : ''
  return `<w:p>${pPr}${run(text)}</w:p>`
}


export function buildDocx(input: DocxBuildInput): Uint8Array {
  const isChinese = input.language.toLowerCase().startsWith('zh')
  const body: string[] = []
  body.push(paragraph(input.title, { style: 'Title' }))
  if (input.author) body.push(paragraph(input.author))
  for (const chapter of input.chapters) {
    body.push(paragraph(chapterHeadingText(chapter, input.language), { style: 'Heading1' }))
    for (const text of proseParagraphs(chapter.content)) {
      body.push(paragraph(text, { firstLineChars: 200 }))
    }
  }

  const document = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<w:document xmlns:w="${W_NS}" xmlns:r="${OFFICE_REL}"><w:body>${body.join('')}<w:sectPr><w:pgSz w:w="11906" w:h="16838"/><w:pgMar w:top="1440" w:right="1440" w:bottom="1440" w:left="1440" w:header="720" w:footer="720" w:gutter="0"/></w:sectPr></w:body></w:document>`

  const styles = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<w:styles xmlns:w="${W_NS}"><w:docDefaults><w:rPrDefault><w:rPr><w:rFonts w:ascii="Times New Roman" w:hAnsi="Times New Roman" w:eastAsia="${isChinese ? '宋体' : 'Times New Roman'}"/><w:sz w:val="24"/><w:lang w:val="${escapeXmlText(input.language)}" w:eastAsia="${escapeXmlText(input.language)}"/></w:rPr></w:rPrDefault><w:pPrDefault><w:pPr><w:spacing w:line="360" w:lineRule="auto"/></w:pPr></w:pPrDefault></w:docDefaults><w:style w:type="paragraph" w:default="1" w:styleId="Normal"><w:name w:val="Normal"/><w:qFormat/></w:style><w:style w:type="paragraph" w:styleId="Title"><w:name w:val="Title"/><w:basedOn w:val="Normal"/><w:next w:val="Normal"/><w:qFormat/><w:pPr><w:jc w:val="center"/><w:spacing w:before="2400" w:after="600" w:line="360" w:lineRule="auto"/></w:pPr><w:rPr><w:rFonts w:eastAsia="${isChinese ? '黑体' : 'Times New Roman'}"/><w:b/><w:sz w:val="52"/></w:rPr></w:style><w:style w:type="paragraph" w:styleId="Heading1"><w:name w:val="heading 1"/><w:basedOn w:val="Normal"/><w:next w:val="Normal"/><w:qFormat/><w:pPr><w:keepNext/><w:spacing w:before="480" w:after="240" w:line="360" w:lineRule="auto"/><w:outlineLvl w:val="0"/></w:pPr><w:rPr><w:rFonts w:eastAsia="${isChinese ? '黑体' : 'Times New Roman'}"/><w:b/><w:sz w:val="32"/></w:rPr></w:style></w:styles>`

  const contentTypes = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/><Default Extension="xml" ContentType="application/xml"/><Override PartName="/word/document.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.document.main+xml"/><Override PartName="/word/styles.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.styles+xml"/><Override PartName="/docProps/core.xml" ContentType="application/vnd.openxmlformats-package.core-properties+xml"/></Types>`

  const packageRels = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Relationships xmlns="${REL_NS}"><Relationship Id="rId1" Type="${OFFICE_REL}/officeDocument" Target="word/document.xml"/><Relationship Id="rId2" Type="http://schemas.openxmlformats.org/package/2006/relationships/metadata/core-properties" Target="docProps/core.xml"/></Relationships>`

  const documentRels = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Relationships xmlns="${REL_NS}"><Relationship Id="rId1" Type="${OFFICE_REL}/styles" Target="styles.xml"/></Relationships>`

  const core = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<cp:coreProperties xmlns:cp="http://schemas.openxmlformats.org/package/2006/metadata/core-properties" xmlns:dc="http://purl.org/dc/elements/1.1/" xmlns:dcterms="http://purl.org/dc/terms/" xmlns:xsi="http://www.w3.org/2001/XMLSchema-instance"><dc:title>${escapeXmlText(input.title)}</dc:title><dc:creator>${escapeXmlText(input.author ?? '')}</dc:creator><cp:lastModifiedBy>${escapeXmlText(input.author ?? '')}</cp:lastModifiedBy><dcterms:created xsi:type="dcterms:W3CDTF">${escapeXmlText(input.createdIso)}</dcterms:created></cp:coreProperties>`

  return buildStoredZip([
    { name: '[Content_Types].xml', bytes: encoder.encode(contentTypes) },
    { name: '_rels/.rels', bytes: encoder.encode(packageRels) },
    { name: 'docProps/core.xml', bytes: encoder.encode(core) },
    { name: 'word/document.xml', bytes: encoder.encode(document) },
    { name: 'word/styles.xml', bytes: encoder.encode(styles) },
    { name: 'word/_rels/document.xml.rels', bytes: encoder.encode(documentRels) },
  ])
}
