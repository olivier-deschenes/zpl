import { getCommandCapability } from 'zplr/web'
import type { CommandCapability, ZplCommandNode, ZplDocument } from 'zplr/web'

/**
 * Plain-language explanations of ZPL for people who don't read it: what a
 * command does, what each of its values means, and a one-line summary of
 * what every field puts on the label.
 */

export interface ExplainContext {
  /** Nominal printer dpi, to turn dots into inches. */
  dpi: number
}

export interface ParameterExplanation {
  name: string
  /** As written, or null when left out. */
  value: string | null
  meaning: string
  /** Which comma-separated value of the command this row comes from. */
  rawIndex: number
}

export interface CommandExplanation {
  canonical: string
  name: string
  summary: string
  parameters: ParameterExplanation[]
  capability: CommandCapability | undefined
}

/** A short sentence shown at the source offset of what it describes. */
export interface ExplainHint {
  offset: number
  text: string
}

type Describe = (value: string, context: ExplainContext) => string

interface ParameterGuide {
  name: string
  describe?: Describe
  /** Said when the value is left out. */
  fallback?: string
}

interface CommandGuide {
  /** Used where zplr only knows the command as "Recognized ZPL command". */
  name?: string
  summary: string
  parameters?: readonly ParameterGuide[]
  /** The whole parameter string is one value: field data has commas in it. */
  raw?: string
  /** One line for the command when it stands outside a field. */
  hint?: (values: Values, context: ExplainContext) => string | null
}

type Values = ReadonlyArray<string | undefined>

// Value describers ----------------------------------------------------------

function formatNumber(value: number) {
  return Number(value.toFixed(2)).toString()
}

function dots(value: string, { dpi }: ExplainContext) {
  const number = Number(value)
  if (!Number.isFinite(number)) return `${value} dots`
  const unit = number === 1 ? 'dot' : 'dots'
  return `${value} ${unit} (${formatNumber(number / dpi)} in)`
}

const fromLeft: Describe = (value, context) =>
  `${dots(value, context)} from the left edge`
const fromTop: Describe = (value, context) =>
  `${dots(value, context)} from the top edge`

const ORIENTATIONS: Partial<Record<string, string>> = {
  N: 'normal',
  R: 'rotated 90° clockwise',
  I: 'upside down',
  B: 'rotated 90° counter-clockwise',
}

const orientation: Describe = (value) =>
  ORIENTATIONS[value.toUpperCase()] ?? `“${value}”, not a known orientation`

function yesNo(yes: string, no: string): Describe {
  return (value) => {
    const upper = value.toUpperCase()
    if (upper === 'Y') return yes
    if (upper === 'N') return no
    return `“${value}”, should be Y or N`
  }
}

function choice(options: Partial<Record<string, string>>): Describe {
  return (value) => options[value.toUpperCase()] ?? `“${value}”`
}

const ENCODINGS: Partial<Record<string, string>> = {
  '0': 'USA 1 (the printer’s original character set)',
  '27': 'Windows-1252',
  '28': 'UTF-8, so any character works',
  '29': 'UTF-16 big-endian',
  '30': 'UTF-16 little-endian',
  '31': 'Zebra code page 1252',
  '33': 'Code page 1250',
  '34': 'Code page 1251',
  '35': 'Code page 1253',
  '36': 'Code page 1254',
  '37': 'Code page 1255',
}

const encoding: Describe = (value) =>
  ENCODINGS[value] ??
  (Number(value) <= 13
    ? `international character set ${value}`
    : `character set ${value}`)

const fontName: Describe = (value) =>
  value === '0'
    ? 'font 0, the built-in scalable font'
    : /^[A-Z]$/i.test(value)
      ? `built-in bitmap font ${value.toUpperCase()}`
      : `font ${value}`

const colour = choice({ B: 'black', W: 'white' })

// Shared parameter lists -----------------------------------------------------

const POSITION: readonly ParameterGuide[] = [
  { name: 'x', describe: fromLeft, fallback: 'Left edge' },
  { name: 'y', describe: fromTop, fallback: 'Top edge' },
  {
    name: 'justify',
    describe: choice({
      '0': 'left-aligned',
      '1': 'right-aligned: x is the right end',
      '2': 'aligned automatically for the script',
    }),
    fallback: 'Left-aligned',
  },
]

const BARCODE_ORIENTATION: ParameterGuide = {
  name: 'orientation',
  describe: orientation,
  fallback: 'The ^FW default, normally upright',
}
const BARCODE_HEIGHT: ParameterGuide = {
  name: 'height',
  describe: (value, context) => `bars are ${dots(value, context)} tall`,
  fallback: 'The height set by ^BY',
}
const HUMAN_READABLE: ParameterGuide = {
  name: 'text line',
  describe: yesNo('prints the content as text too', 'no text, only the bars'),
  fallback: 'Prints the content as text too',
}
const TEXT_ABOVE: ParameterGuide = {
  name: 'text above',
  describe: yesNo('the text goes above the bars', 'the text goes below'),
  fallback: 'Below the bars',
}
const CHECK_DIGIT: ParameterGuide = {
  name: 'check digit',
  describe: yesNo('adds a check digit', 'no extra check digit'),
  fallback: 'No extra check digit',
}

const LINEAR_BARCODE: readonly ParameterGuide[] = [
  BARCODE_ORIENTATION,
  BARCODE_HEIGHT,
  HUMAN_READABLE,
  TEXT_ABOVE,
]

const SHAPE_THICKNESS: ParameterGuide = {
  name: 'thickness',
  describe: (value, context) => `outline is ${dots(value, context)} thick`,
  fallback: '1 dot',
}
const SHAPE_COLOUR: ParameterGuide = {
  name: 'colour',
  describe: colour,
  fallback: 'Black',
}

// The guide ----------------------------------------------------------------

const GUIDES: Partial<Record<string, CommandGuide>> = {
  '^XA': {
    summary:
      'Starts a label. Everything up to the next ^XZ describes one label.',
    hint: () => 'Start of label',
  },
  '^XZ': {
    summary: 'Ends the label. The printer prints it when it reads this.',
    hint: () => 'End of label',
  },
  '^FX': {
    summary: 'A comment: a note for people reading the code. Nothing prints.',
    raw: 'note',
  },

  // Label setup
  '^PW': {
    summary: 'Sets how wide the label is.',
    parameters: [{ name: 'width', describe: dots }],
    hint: ([width], context) =>
      width ? `Label is ${dots(width, context)} wide` : null,
  },
  '^LL': {
    summary: 'Sets how long (tall) the label is.',
    parameters: [{ name: 'length', describe: dots }],
    hint: ([length], context) =>
      length ? `Label is ${dots(length, context)} long` : null,
  },
  '^LH': {
    summary:
      'Moves the starting corner. Every position after it is measured from this point instead of the label’s top-left corner.',
    parameters: [
      { name: 'x', describe: fromLeft, fallback: 'Left edge' },
      { name: 'y', describe: fromTop, fallback: 'Top edge' },
    ],
    hint: ([x = '0', y = '0']) => `Positions below start from (${x}, ${y})`,
  },
  '^LS': {
    summary: 'Shifts everything on the label left or right.',
    parameters: [
      {
        name: 'shift',
        describe: (value, context) =>
          `${dots(value, context)}; negative moves left`,
      },
    ],
  },
  '^LT': {
    summary: 'Moves everything on the label up or down.',
    parameters: [
      {
        name: 'shift',
        describe: (value, context) =>
          `${dots(value, context)}; negative moves up`,
      },
    ],
  },
  '^LR': {
    summary: 'Inverts the whole label: black prints white and white black.',
    parameters: [
      {
        name: 'invert',
        describe: yesNo('inverted', 'printed normally'),
        fallback: 'Printed normally',
      },
    ],
    hint: ([value]) =>
      value?.toUpperCase() === 'Y' ? 'Whole label printed inverted' : null,
  },
  '^PO': {
    summary: 'Prints the whole label right side up or upside down.',
    parameters: [
      {
        name: 'orientation',
        describe: choice({ N: 'right side up', I: 'upside down' }),
        fallback: 'Right side up',
      },
    ],
    hint: ([value]) =>
      value?.toUpperCase() === 'I' ? 'Whole label printed upside down' : null,
  },
  '^PM': {
    summary: 'Mirrors the whole label, as if seen in a mirror.',
    parameters: [
      {
        name: 'mirror',
        describe: yesNo('mirrored', 'not mirrored'),
        fallback: 'Not mirrored',
      },
    ],
    hint: ([value]) =>
      value?.toUpperCase() === 'Y' ? 'Whole label mirrored' : null,
  },
  '^PQ': {
    summary: 'Sets how many copies of this label to print.',
    parameters: [
      { name: 'copies', fallback: '1' },
      { name: 'pause every', fallback: 'Never pauses' },
      { name: 'repeats', fallback: '0' },
      {
        name: 'no pause',
        describe: yesNo('never pauses', 'pauses as set'),
        fallback: 'Pauses as set',
      },
    ],
    hint: ([copies = '1']) =>
      `Print ${copies} ${copies === '1' ? 'copy' : 'copies'}`,
  },
  '^MU': {
    summary:
      'Sets the unit every size and position after it is written in. Dots is the usual one.',
    parameters: [
      {
        name: 'unit',
        describe: choice({ D: 'dots', I: 'inches', M: 'millimetres' }),
        fallback: 'Dots',
      },
    ],
    hint: ([unit]) =>
      unit
        ? `Sizes below are in ${choice({ D: 'dots', I: 'inches', M: 'millimetres' })(unit, { dpi: 0 })}`
        : null,
  },
  '^MD': {
    name: 'Media Darkness',
    summary:
      'Makes the print darker or lighter on top of the printer’s own setting.',
    parameters: [
      { name: 'change', describe: (value) => `${value}, from -30 to 30` },
    ],
    hint: ([value]) => (value ? `Print darkness ${value}` : null),
  },
  '~SD': {
    name: 'Set Darkness',
    summary: 'Sets how dark the printer prints, from 0 to 30.',
    parameters: [{ name: 'darkness' }],
    hint: ([value]) => (value ? `Print darkness ${value}` : null),
  },
  '^PR': {
    name: 'Print Rate',
    summary:
      'Sets how fast the label moves through the printer. Slower is often crisper.',
    parameters: [
      { name: 'print speed', describe: (value) => `${value} inches a second` },
      { name: 'feed speed', describe: (value) => `${value} inches a second` },
      {
        name: 'backfeed speed',
        describe: (value) => `${value} inches a second`,
      },
    ],
    hint: ([speed]) => (speed ? `Print speed ${speed} in/s` : null),
  },
  '^MN': {
    summary:
      'Tells the printer how to find where one label ends and the next begins.',
    parameters: [
      {
        name: 'media',
        describe: choice({
          N: 'continuous roll, no gaps',
          Y: 'labels with gaps between them',
          W: 'labels with gaps between them',
          M: 'labels with a black mark on the back',
          A: 'detected automatically',
        }),
      },
    ],
  },
  '^MT': {
    summary: 'Tells the printer whether it prints with a ribbon.',
    parameters: [
      {
        name: 'type',
        describe: choice({
          T: 'thermal transfer, with a ribbon',
          D: 'direct thermal, heat-sensitive labels without a ribbon',
        }),
      },
    ],
  },
  '^MM': {
    summary:
      'Sets what the printer does after a label: tear off, peel, cut, and so on.',
    parameters: [
      {
        name: 'mode',
        describe: choice({
          T: 'tear off',
          P: 'peel off',
          R: 'rewind',
          C: 'cut',
          A: 'applicator',
          D: 'delayed cut',
          K: 'kiosk',
        }),
      },
    ],
  },
  '^CI': {
    summary:
      'Picks the character set text is read in. 28 (UTF-8) lets accents and other languages print correctly.',
    parameters: [{ name: 'character set', describe: encoding }],
    hint: ([value]) =>
      value ? `Text encoding: ${encoding(value, { dpi: 0 })}` : null,
  },
  '^FW': {
    summary:
      'Sets the default direction for every text and barcode after it, unless they set their own.',
    parameters: [
      { name: 'orientation', describe: orientation, fallback: 'Normal' },
      {
        name: 'justify',
        describe: choice({ '0': 'left', '1': 'right', '2': 'automatic' }),
        fallback: 'Left',
      },
    ],
    hint: ([value]) =>
      value
        ? `Text and barcodes below are ${orientation(value, { dpi: 0 })}`
        : null,
  },

  // Text
  '^CF': {
    summary:
      'Sets the default font and size for text after it. Text can still pick its own with ^A.',
    parameters: [
      { name: 'font', describe: fontName, fallback: 'Unchanged' },
      {
        name: 'height',
        describe: (value, context) => `letters ${dots(value, context)} tall`,
        fallback: 'Unchanged',
      },
      {
        name: 'width',
        describe: (value, context) => `letters ${dots(value, context)} wide`,
        fallback: 'In proportion to the height',
      },
    ],
    hint: ([font, height]) =>
      [
        'Text below uses',
        font !== undefined ? `font ${font}` : 'the same font',
        height ? `at ${height} dots tall` : '',
      ]
        .filter(Boolean)
        .join(' '),
  },
  '^A': {
    summary:
      'Picks the font and size for the next text only. The character right after ^A is the font’s name.',
    parameters: [
      { name: 'font', describe: fontName },
      {
        name: 'orientation',
        describe: orientation,
        fallback: 'The ^FW default, normally upright',
      },
      {
        name: 'height',
        describe: (value, context) => `letters ${dots(value, context)} tall`,
        fallback: 'The ^CF default',
      },
      {
        name: 'width',
        describe: (value, context) => `letters ${dots(value, context)} wide`,
        fallback: 'In proportion to the height',
      },
    ],
  },
  '^A@': {
    summary:
      'Picks a font stored on the printer by its file name, for the next text.',
    parameters: [
      { name: 'orientation', describe: orientation, fallback: 'Normal' },
      {
        name: 'height',
        describe: (value, context) => `letters ${dots(value, context)} tall`,
      },
      {
        name: 'width',
        describe: (value, context) => `letters ${dots(value, context)} wide`,
        fallback: 'In proportion to the height',
      },
      { name: 'file', describe: (value) => `the font file ${value}` },
    ],
  },
  '^FB': {
    summary:
      'Wraps the next text into a block of a set width, over several lines if needed.',
    parameters: [
      {
        name: 'width',
        describe: (value, context) => `block is ${dots(value, context)} wide`,
      },
      { name: 'max lines', fallback: '1' },
      {
        name: 'line spacing',
        describe: (value, context) =>
          `${dots(value, context)} extra between lines`,
        fallback: 'No extra space',
      },
      {
        name: 'align',
        describe: choice({
          L: 'left',
          C: 'centred',
          R: 'right',
          J: 'justified',
        }),
        fallback: 'Left',
      },
      {
        name: 'indent',
        describe: (value, context) =>
          `lines after the first are indented ${dots(value, context)}`,
        fallback: 'No indent',
      },
    ],
  },
  '^FH': {
    summary:
      'Lets the next ^FD write special characters as hex codes, like _0A, after the given marker.',
    parameters: [{ name: 'marker', fallback: '_ (underscore)' }],
  },

  // Fields
  '^FO': {
    summary:
      'Sets where the next item goes: its top-left corner, measured from the label’s top-left corner.',
    parameters: POSITION,
  },
  '^FT': {
    summary:
      'Sets where the next item goes, like ^FO, but measured to the bottom-left of text (where the letters sit).',
    parameters: POSITION,
  },
  '^FD': {
    summary:
      'The content of the item: the words to print, or what the barcode encodes.',
    raw: 'content',
  },
  '^FV': {
    summary:
      'Like ^FD, but the content can change between copies, as in a template.',
    raw: 'content',
  },
  '^FS': {
    summary:
      'Ends the current item. Every item on the label finishes with ^FS.',
  },
  '^FR': {
    summary:
      'Prints this item inverted: white where it overlaps black. This is how white text on a black bar is made.',
  },
  '^FN': {
    summary:
      'Gives the item a number so a template can fill in its content later.',
    parameters: [{ name: 'number' }],
  },
  '^FM': {
    summary: 'Places the same item at several positions.',
  },

  // Shapes
  '^GB': {
    summary:
      'Draws a box. Make it as thick as it is tall and it becomes a line or a solid bar.',
    parameters: [
      {
        name: 'width',
        describe: (value, context) => `${dots(value, context)} wide`,
        fallback: 'As wide as it is thick',
      },
      {
        name: 'height',
        describe: (value, context) => `${dots(value, context)} tall`,
        fallback: 'As tall as it is thick',
      },
      SHAPE_THICKNESS,
      SHAPE_COLOUR,
      {
        name: 'rounding',
        describe: (value) =>
          value === '0' ? 'square corners' : `rounded corners, ${value} of 8`,
        fallback: 'Square corners',
      },
    ],
  },
  '^GC': {
    summary: 'Draws a circle.',
    parameters: [
      {
        name: 'diameter',
        describe: (value, context) => `${dots(value, context)} across`,
      },
      SHAPE_THICKNESS,
      SHAPE_COLOUR,
    ],
  },
  '^GE': {
    summary: 'Draws an ellipse (an oval).',
    parameters: [
      {
        name: 'width',
        describe: (value, context) => `${dots(value, context)} wide`,
      },
      {
        name: 'height',
        describe: (value, context) => `${dots(value, context)} tall`,
      },
      SHAPE_THICKNESS,
      SHAPE_COLOUR,
    ],
  },
  '^GD': {
    summary: 'Draws a diagonal line across a box of the given size.',
    parameters: [
      {
        name: 'width',
        describe: (value, context) => `${dots(value, context)} wide`,
      },
      {
        name: 'height',
        describe: (value, context) => `${dots(value, context)} tall`,
      },
      SHAPE_THICKNESS,
      SHAPE_COLOUR,
      {
        name: 'direction',
        describe: choice({
          R: 'leans right, like /',
          '/': 'leans right, like /',
          L: 'leans left, like \\',
          '\\': 'leans left, like \\',
        }),
        fallback: 'Leans right, like /',
      },
    ],
  },
  '^GF': {
    summary:
      'Draws a picture, written out dot by dot in the code. The long block of letters and numbers is the image.',
    parameters: [
      {
        name: 'format',
        describe: choice({
          A: 'hex text',
          B: 'binary',
          C: 'compressed binary',
        }),
      },
      { name: 'data size', describe: (value) => `${value} bytes` },
      { name: 'total size', describe: (value) => `${value} bytes` },
      {
        name: 'bytes per row',
        describe: (value) =>
          `${value} bytes, so ${Number(value) * 8} dots wide`,
      },
      { name: 'image data', describe: () => 'the picture itself' },
    ],
  },
  '^XG': {
    summary: 'Draws an image saved on the printer earlier.',
    parameters: [
      { name: 'image', describe: (value) => `the image named ${value}` },
      { name: 'x scale', fallback: '1' },
      { name: 'y scale', fallback: '1' },
    ],
  },

  // Barcodes
  '^BY': {
    summary:
      'Sets the default bar size for barcodes after it. Wider bars make a bigger, easier-to-scan barcode.',
    parameters: [
      {
        name: 'bar width',
        describe: (value, context) =>
          `narrowest bar is ${dots(value, context)}`,
        fallback: '2 dots',
      },
      {
        name: 'ratio',
        describe: (value) => `wide bars are ${value}× the narrow ones`,
        fallback: '3',
      },
      {
        name: 'height',
        describe: (value, context) => `${dots(value, context)} tall`,
        fallback: '10 dots',
      },
    ],
    hint: ([width = '2', , height]) =>
      `Barcodes below: bars ${width} dots wide${height ? `, ${height} dots tall` : ''}`,
  },
  '^BC': {
    summary:
      'Draws a Code 128 barcode, the most common shipping barcode. The ^FD after it holds the content.',
    parameters: [
      ...LINEAR_BARCODE,
      { ...CHECK_DIGIT, name: 'UCC check digit' },
      {
        name: 'mode',
        describe: choice({
          N: 'normal',
          U: 'UCC case mode',
          A: 'automatic',
          D: 'GS1 / UCC/EAN',
        }),
        fallback: 'Normal',
      },
    ],
  },
  '^B3': {
    summary: 'Draws a Code 39 barcode. The ^FD after it holds the content.',
    parameters: [
      BARCODE_ORIENTATION,
      CHECK_DIGIT,
      BARCODE_HEIGHT,
      HUMAN_READABLE,
      TEXT_ABOVE,
    ],
  },
  '^BE': {
    summary:
      'Draws an EAN-13 barcode, used on retail products. The ^FD after it holds the 12 digits.',
    parameters: LINEAR_BARCODE,
  },
  '^BU': {
    summary:
      'Draws a UPC-A barcode, used on retail products. The ^FD after it holds the 11 digits.',
    parameters: [...LINEAR_BARCODE, CHECK_DIGIT],
  },
  '^B8': {
    summary: 'Draws an EAN-8 barcode. The ^FD after it holds the 7 digits.',
    parameters: LINEAR_BARCODE,
  },
  '^B9': {
    summary: 'Draws a UPC-E barcode. The ^FD after it holds the digits.',
    parameters: [...LINEAR_BARCODE, CHECK_DIGIT],
  },
  '^B2': {
    summary:
      'Draws an Interleaved 2 of 5 barcode, for digits only. The ^FD after it holds the content.',
    parameters: [...LINEAR_BARCODE, CHECK_DIGIT],
  },
  '^BA': {
    summary: 'Draws a Code 93 barcode. The ^FD after it holds the content.',
    parameters: [...LINEAR_BARCODE, CHECK_DIGIT],
  },
  '^BQ': {
    summary:
      'Draws a QR code. In the ^FD after it, the first letters (like “QA,”) set its error correction; the rest is the content.',
    parameters: [
      { name: 'orientation', describe: () => 'always normal' },
      {
        name: 'model',
        describe: choice({ '1': 'original model', '2': 'enhanced model' }),
        fallback: 'Enhanced model (2)',
      },
      {
        name: 'size',
        describe: (value) => `each square is ${value} dots`,
        fallback: 'Depends on the printer',
      },
      {
        name: 'error correction',
        describe: choice({
          H: 'highest: still scans when 30% is damaged',
          Q: 'high: 25%',
          M: 'standard: 15%',
          L: 'lowest: 7%',
        }),
        fallback: 'Set by the ^FD prefix',
      },
      { name: 'mask', fallback: 'Chosen automatically' },
    ],
  },
  '^BX': {
    summary:
      'Draws a Data Matrix code, a small square 2D code. The ^FD after it holds the content.',
    parameters: [
      BARCODE_ORIENTATION,
      {
        name: 'square size',
        describe: (value, context) => `each square is ${dots(value, context)}`,
      },
      {
        name: 'quality',
        describe: (value) =>
          value === '200' ? 'ECC 200, the standard' : value,
        fallback: 'ECC 0',
      },
      { name: 'columns', fallback: 'Chosen automatically' },
      { name: 'rows', fallback: 'Chosen automatically' },
    ],
  },
  '^B7': {
    summary:
      'Draws a PDF417 code, a stacked 2D barcode often used on IDs. The ^FD after it holds the content.',
    parameters: [
      BARCODE_ORIENTATION,
      {
        name: 'row height',
        describe: (value, context) =>
          `each row is ${dots(value, context)} tall`,
      },
      { name: 'security level', fallback: 'Chosen automatically' },
      { name: 'columns', fallback: 'Chosen automatically' },
      { name: 'rows', fallback: 'Chosen automatically' },
      {
        name: 'truncate',
        describe: yesNo('shortened right edge', 'full width'),
        fallback: 'Full width',
      },
    ],
  },

  // Stored things
  '~DG': {
    summary: 'Saves an image in the printer’s memory, to draw later with ^XG.',
  },
  '^DF': {
    summary:
      'Saves this label as a template in the printer, to reuse with ^XF.',
  },
  '^XF': {
    summary: 'Loads a label template saved earlier with ^DF.',
  },
  '~JA': {
    summary: 'Cancels every label waiting to print.',
  },
}

const CATEGORY_SUMMARIES: Partial<
  Record<CommandCapability['category'], string>
> = {
  text: 'Changes how text looks.',
  graphic: 'Draws a shape or picture.',
  storage:
    'Saves or loads something kept in the printer’s memory, like an image, font or template.',
  format: 'Changes how the rest of the label is laid out.',
}

const PRINTER_SUMMARY =
  'A printer setting. It changes how the printer behaves, not what is drawn, so the preview skips it.'

// Lookup ---------------------------------------------------------------------

function capabilityOf(command: Pick<ZplCommandNode, 'canonical'>) {
  return getCommandCapability(command.canonical)
}

function nameOf(canonical: string, capability: CommandCapability | undefined) {
  const guide = GUIDES[canonical]
  if (guide?.name) return guide.name
  // zplr names commands it only recognises after themselves.
  if (capability && !capability.name.startsWith('Recognized')) {
    return capability.name
  }
  return null
}

/** Barcode names read better without zplr's trailing "Bar Code". */
function barcodeName(name: string) {
  const short = name.replace(/ Bar Code$/, '')
  return /code$/i.test(short) ? short : `${short} barcode`
}

function valuesOf(command: Pick<ZplCommandNode, 'code' | 'parameters'>): {
  values: Values
  rawIndexes: number[]
} {
  const trimmed = command.parameters.map((value) => value.trim())
  if (command.code === 'A') {
    // ^A0N,30,30: the font name and orientation share the first value.
    const [first = '', ...rest] = trimmed
    return {
      values: [
        first.slice(0, 1) || undefined,
        first.slice(1) || undefined,
        ...rest,
      ],
      rawIndexes: [0, 0, ...rest.map((_, index) => index + 1)],
    }
  }
  return { values: trimmed, rawIndexes: trimmed.map((_, index) => index) }
}

export function explainCommand(
  command: Pick<
    ZplCommandNode,
    'canonical' | 'code' | 'parameters' | 'rawParameters'
  >,
  context: ExplainContext,
): CommandExplanation {
  const capability = capabilityOf(command)
  const guide = GUIDES[command.canonical]
  const name = nameOf(command.canonical, capability) ?? 'Unrecognised command'

  let summary = guide?.summary
  if (!summary && capability) {
    summary =
      capability.category === 'barcode'
        ? `Draws a ${barcodeName(capability.name)}. The ^FD after it holds the content.`
        : capability.status === 'non-rendering' ||
            capability.effect === 'device'
          ? PRINTER_SUMMARY
          : (CATEGORY_SUMMARIES[capability.category] ?? PRINTER_SUMMARY)
  }
  summary ??=
    'The preview doesn’t know this command. Check its spelling, or whether your printer model has it.'

  const parameters: ParameterExplanation[] = []
  if (guide?.raw) {
    const value = command.rawParameters.trim()
    parameters.push({
      name: guide.raw,
      value: value || null,
      meaning: value ? `“${value}”` : 'Empty',
      rawIndex: 0,
    })
  } else {
    const { values, rawIndexes } = valuesOf(command)
    guide?.parameters?.forEach((parameter, index) => {
      const value = values[index]
      const given = value !== undefined && value !== ''
      parameters.push({
        name: parameter.name,
        value: given ? value : null,
        meaning: given
          ? (parameter.describe?.(value, context) ?? value)
          : (parameter.fallback ?? 'Left out, so the printer’s default'),
        rawIndex: rawIndexes[index] ?? index,
      })
    })
  }

  return { canonical: command.canonical, name, summary, parameters, capability }
}

/** Which comma-separated value of `command` the source offset falls in. */
export function parameterIndexAt(
  command: Pick<ZplCommandNode, 'span' | 'rawParameters' | 'delimiter'>,
  offset: number,
): number | null {
  const rawStart = command.span.end - command.rawParameters.length
  if (offset < rawStart) return null
  const before = command.rawParameters.slice(0, offset - rawStart)
  return before.split(command.delimiter).length - 1
}

// Line hints -----------------------------------------------------------------

/** Commands that build up one field between ^FO/^FT and ^FS. */
const FIELD_COMMANDS = new Set([
  'FO',
  'FT',
  'A',
  'A@',
  'FD',
  'FV',
  'FR',
  'FB',
  'FH',
  'FN',
  'FS',
  'TB',
])

interface Field {
  start: number
  x?: string
  y?: string
  fontHeight?: string
  orientation?: string
  data?: string
  reverse: boolean
  blockWidth?: string
  slot?: string
  /** What the field draws when it isn't plain text. */
  drawing?: ZplCommandNode
}

interface LabelState {
  fontHeight?: string
  orientation?: string
  barcodeHeight?: string
}

const BARCODE_HEIGHT_INDEX: Partial<Record<string, number>> = {
  BC: 1,
  B3: 2,
  BE: 1,
  BU: 1,
  B8: 1,
  B9: 1,
  B2: 1,
  BA: 1,
}

function quote(value: string, max = 32) {
  const text = value.replace(/\s+/g, ' ').trim()
  return `“${text.length > max ? `${text.slice(0, max - 1)}…` : text}”`
}

function valueAt(command: ZplCommandNode, index: number) {
  const raw = command.parameters[index]?.trim()
  return raw === '' ? undefined : raw
}

function describeDrawing(
  drawing: ZplCommandNode,
  field: Field,
  label: LabelState,
) {
  const number = (index: number, fallback: number) => {
    const parsed = Number(valueAt(drawing, index))
    return Number.isFinite(parsed) && valueAt(drawing, index) !== undefined
      ? parsed
      : fallback
  }

  switch (drawing.code) {
    case 'GB': {
      const thickness = number(2, 1)
      const width = Math.max(number(0, thickness), thickness)
      const height = Math.max(number(1, thickness), thickness)
      const filled = thickness * 2 >= Math.min(width, height)
      // A filled box much longer than it is thick reads as a line.
      const shape =
        filled && height * 10 <= width
          ? `horizontal line, ${width} dots long`
          : filled && width * 10 <= height
            ? `vertical line, ${height} dots long`
            : filled
              ? `solid box, ${width} × ${height} dots`
              : `box outline, ${width} × ${height} dots`
      const white = valueAt(drawing, 3)?.toUpperCase() === 'W'
      return white
        ? `White ${shape}`
        : shape.charAt(0).toUpperCase() + shape.slice(1)
    }
    case 'GC':
      return `Circle, ${number(0, 3)} dots across`
    case 'GE':
      return `Ellipse, ${number(0, 3)} × ${number(1, 3)} dots`
    case 'GD':
      return `Diagonal line across ${number(0, 3)} × ${number(1, 3)} dots`
    case 'GF': {
      const total = number(2, 0)
      const perRow = number(3, 0)
      return perRow > 0
        ? `Picture, ${perRow * 8} × ${Math.round(total / perRow)} dots`
        : 'Picture'
    }
    case 'XG':
      return `Saved image ${valueAt(drawing, 0) ?? ''}`.trim()
    case 'GS':
      return 'Symbol'
  }

  const capability = capabilityOf(drawing)
  if (capability?.category !== 'barcode') return capability?.name ?? 'Item'

  const kind = barcodeName(capability.name)
  let content = field.data
  if (drawing.code === 'BQ' && content) {
    // QR data starts with its error correction and input mode, like "QA,".
    content = content.replace(/^[HQML]?[AM],/i, '')
  }
  const heightIndex = BARCODE_HEIGHT_INDEX[drawing.code]
  const height =
    heightIndex === undefined
      ? undefined
      : (valueAt(drawing, heightIndex) ?? label.barcodeHeight)
  return [
    content ? `${kind} ${quote(content)}` : kind,
    height ? `${height} dots tall` : null,
  ]
    .filter(Boolean)
    .join(', ')
}

function describeField(field: Field, label: LabelState) {
  const parts: string[] = []
  if (field.drawing) {
    parts.push(describeDrawing(field.drawing, field, label))
  } else if (field.data !== undefined) {
    parts.push(`Text ${quote(field.data)}`)
    const height = field.fontHeight ?? label.fontHeight
    if (height) parts.push(`${height} dots tall`)
    if (field.blockWidth) parts.push(`wrapped to ${field.blockWidth} dots wide`)
  } else if (field.slot) {
    parts.push(`Fill-in slot #${field.slot}`)
  } else {
    return null
  }

  const turn = (field.orientation ?? label.orientation)?.toUpperCase()
  if (turn && turn !== 'N' && ORIENTATIONS[turn]) parts.push(ORIENTATIONS[turn])
  if (field.reverse) parts.push('printed inverted')
  parts.push(`at (${field.x ?? 0}, ${field.y ?? 0})`)
  return parts.join(', ')
}

function standaloneHint(command: ZplCommandNode, context: ExplainContext) {
  const guide = GUIDES[command.canonical]
  if (guide?.hint) return guide.hint(valuesOf(command).values, context)
  if (guide?.raw) return null
  return nameOf(command.canonical, capabilityOf(command))
}

/**
 * One plain-language line per field (text, barcode, box…) and per setting,
 * at the offset where it starts in the source.
 */
export function explainDocument(
  document: Pick<ZplDocument, 'items'>,
  context: ExplainContext,
): ExplainHint[] {
  const hints: ExplainHint[] = []
  const push = (offset: number, text: string | null) => {
    if (text) hints.push({ offset, text })
  }

  for (const item of document.items) {
    if (item.kind === 'command') {
      push(item.span.start, standaloneHint(item, context))
      continue
    }

    const label: LabelState = {}
    let field: Field | null = null
    const startField = (command: ZplCommandNode) =>
      (field ??= { start: command.span.start, reverse: false })

    for (const command of item.commands) {
      const { code } = command
      const capability = capabilityOf(command)
      const draws =
        capability?.category === 'barcode' && code !== 'BY'
          ? true
          : ['GB', 'GC', 'GE', 'GD', 'GF', 'GS', 'XG'].includes(code)

      if (!FIELD_COMMANDS.has(code) && !draws) {
        if (code === 'CF')
          label.fontHeight = valueAt(command, 1) ?? label.fontHeight
        if (code === 'FW')
          label.orientation = valueAt(command, 0) ?? label.orientation
        if (code === 'BY')
          label.barcodeHeight = valueAt(command, 2) ?? label.barcodeHeight
        push(command.span.start, standaloneHint(command, context))
        continue
      }

      const current = startField(command)
      switch (code) {
        case 'FO':
        case 'FT':
          current.x = valueAt(command, 0)
          current.y = valueAt(command, 1)
          break
        case 'A':
        case 'A@': {
          const { values } = valuesOf(command)
          const offset = code === 'A' ? 1 : 0
          current.orientation = values[offset] ?? current.orientation
          current.fontHeight = values[offset + 1] ?? current.fontHeight
          break
        }
        case 'FD':
        case 'FV':
          current.data = command.rawParameters
          break
        case 'FR':
          current.reverse = true
          break
        case 'FB':
        case 'TB':
          current.blockWidth = valueAt(command, code === 'TB' ? 1 : 0)
          break
        case 'FN':
          current.slot = valueAt(command, 0)
          break
        case 'FS':
          push(current.start, describeField(current, label))
          field = null
          break
        default:
          current.drawing = command
      }
    }

    // A label can end without closing its last field.
    const unfinished = field as Field | null
    if (unfinished) push(unfinished.start, describeField(unfinished, label))
  }

  return hints.sort((a, b) => a.offset - b.offset)
}
