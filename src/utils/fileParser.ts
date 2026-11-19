import mammoth from 'mammoth';
import { Question } from '../types';

export interface ParsedQuizResult {
  titleSuggestion?: string;
  descriptionSuggestion?: string;
  timeLimitSuggestion?: number;
  questions: Question[];
  warnings: string[];
}

function makeId(): string {
  return `q-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
}

function letterToIndex(letter: string): number {
  const clean = letter.trim().toUpperCase().charAt(0);
  if (clean === 'A' || clean === '1') return 0;
  if (clean === 'B' || clean === '2') return 1;
  if (clean === 'C' || clean === '3') return 2;
  if (clean === 'D' || clean === '4') return 3;
  return -1;
}

export function parseStructuredTextQuestions(rawText: string): ParsedQuizResult {
  const warnings: string[] = [];
  const normalized = rawText.replace(/\r\n/g, '\n').replace(/\r/g, '\n').trim();
  if (!normalized) {
    return { questions: [], warnings: ['Nội dung tệp rỗng.'] };
  }

  const lines = normalized.split('\n');
  const blocks: string[][] = [];
  let currentBlock: string[] = [];

  const questionStartRegex = /^(?:Câu\s*\d+\s*[:.)\-]?|Bài\s*\d+\s*[:.)\-]?|\d+\s*[.)])\s+/i;

  for (const rawLine of lines) {
    const line = rawLine.trim();
    if (!line) {
      if (currentBlock.length > 0) {
        currentBlock.push('');
      }
      continue;
    }
    if (questionStartRegex.test(line) && currentBlock.some((l) => l.trim().length > 0)) {
      blocks.push(currentBlock);
      currentBlock = [line];
    } else {
      currentBlock.push(line);
    }
  }
  if (currentBlock.some((l) => l.trim().length > 0)) {
    blocks.push(currentBlock);
  }

  // Fallback: if no numbered prefixes found, split by double blank lines
  const candidateBlocks =
    blocks.length <= 1 && normalized.includes('\n\n')
      ? normalized
          .split(/\n\s*\n+/)
          .map((chunk) => chunk.split('\n').map((l) => l.trim()))
      : blocks;

  const questions: Question[] = [];

  for (let i = 0; i < candidateBlocks.length; i++) {
    const blockLines = candidateBlocks[i].filter((l) => l.trim() !== '');
    if (blockLines.length === 0) continue;

    // Expand inline options like "A. ... B. ... C. ... D. ..." if placed on same line
    const expandedLines: string[] = [];
    for (const line of blockLines) {
      const splitInline = line.replace(/\s+(?=[*]?[A-D][.)]\s+)/g, '\n').split('\n');
      for (const s of splitInline) {
        if (s.trim()) expandedLines.push(s.trim());
      }
    }

    const questionTextParts: string[] = [];
    const options: [string, string, string, string] = ['', '', '', ''];
    let detectedCorrect = -1;
    let explanation = '';
    let currentOptionIndex = -1;
    let inExplanation = false;

    const optionRegex = /^(\*)?\s*([A-Da-d])\s*[.)\-:]\s*(.+)$/;
    const answerRegex = /^(?:Đáp án(?:\s+đúng)?|ĐA|DA|Answer|Key)\s*[:\-]\s*(.+)$/i;
    const explanationRegex = /^(?:Giải thích|Ghi chú|Hướng dẫn|Explanation)\s*[:\-]\s*(.*)$/i;

    for (const line of expandedLines) {
      const ansMatch = line.match(answerRegex);
      if (ansMatch) {
        const idx = letterToIndex(ansMatch[1]);
        if (idx >= 0) detectedCorrect = idx;
        inExplanation = false;
        currentOptionIndex = -1;
        continue;
      }

      const expMatch = line.match(explanationRegex);
      if (expMatch) {
        explanation = expMatch[1].trim();
        inExplanation = true;
        currentOptionIndex = -1;
        continue;
      }

      const optMatch = line.match(optionRegex);
      if (optMatch) {
        const hasLeadingStar = Boolean(optMatch[1]);
        const idx = letterToIndex(optMatch[2]);
        let optText = optMatch[3].trim();
        const hasTrailingStar = optText.endsWith('*') && !optText.endsWith('\\*');
        if (hasTrailingStar) {
          optText = optText.slice(0, -1).trim();
        }
        if (idx >= 0) {
          options[idx] = optText;
          if (hasLeadingStar || hasTrailingStar) {
            detectedCorrect = idx;
          }
          currentOptionIndex = idx;
          inExplanation = false;
          continue;
        }
      }

      if (inExplanation) {
        explanation = explanation ? `${explanation} ${line}` : line;
      } else if (currentOptionIndex >= 0) {
        options[currentOptionIndex] = `${options[currentOptionIndex]} ${line}`.trim();
      } else {
        const cleaned = line.replace(questionStartRegex, '').trim();
        questionTextParts.push(cleaned);
      }
    }

    const text = questionTextParts.join(' ').trim();
    const validOptionsCount = options.filter((o) => o.trim().length > 0).length;

    if (!text || validOptionsCount < 2) {
      warnings.push(`Khối #${i + 1} không đủ câu hỏi hoặc đáp án A/B/C/D để nhập.`);
      continue;
    }

    for (let k = 0; k < 4; k++) {
      if (!options[k]) options[k] = `Phương án ${String.fromCharCode(65 + k)}`;
    }

    if (detectedCorrect < 0 || detectedCorrect > 3) {
      detectedCorrect = 0;
      warnings.push(`Câu "${text.slice(0, 40)}..." chưa ghi rõ đáp án đúng, tạm đặt mặc định là A.`);
    }

    questions.push({
      id: makeId(),
      text,
      options,
      correctIndex: detectedCorrect,
      explanation,
    });
  }

  return { questions, warnings };
}

function splitCsvRow(row: string, delimiter: string): string[] {
  const cells: string[] = [];
  let current = '';
  let inQuotes = false;

  for (let i = 0; i < row.length; i++) {
    const ch = row[i];
    if (ch === '"') {
      if (inQuotes && row[i + 1] === '"') {
        current += '"';
        i += 1;
      } else {
        inQuotes = !inQuotes;
      }
    } else if (ch === delimiter && !inQuotes) {
      cells.push(current.trim());
      current = '';
    } else {
      current += ch;
    }
  }
  cells.push(current.trim());
  return cells;
}

export function parseCsvQuestions(rawCsv: string): ParsedQuizResult {
  const clean = rawCsv.replace(/^\uFEFF/, '').replace(/\r\n/g, '\n').replace(/\r/g, '\n').trim();
  const warnings: string[] = [];
  if (!clean) return { questions: [], warnings: ['Tệp CSV rỗng.'] };

  const lines = clean.split('\n').filter((l) => l.trim().length > 0);
  if (lines.length === 0) return { questions: [], warnings: ['Không tìm thấy dòng dữ liệu CSV.'] };

  const firstLine = lines[0];
  const commaCount = (firstLine.match(/,/g) || []).length;
  const semiCount = (firstLine.match(/;/g) || []).length;
  const delimiter = semiCount > commaCount ? ';' : ',';

  const rows = lines.map((line) => splitCsvRow(line, delimiter));
  const headerLower = rows[0].map((c) => c.toLowerCase());
  const hasHeader =
    headerLower.some((h) => h.includes('câu') || h.includes('question') || h.includes('đáp án'));

  const startRow = hasHeader ? 1 : 0;
  const questions: Question[] = [];

  for (let i = startRow; i < rows.length; i++) {
    const r = rows[i];
    if (r.length < 5 || !r[0]) {
      warnings.push(`Dòng ${i + 1} CSV thiếu cột (cần tối thiểu: Câu hỏi, A, B, C, D, Đáp án đúng).`);
      continue;
    }
    const text = r[0].trim();
    const options: [string, string, string, string] = [
      (r[1] || 'Phương án A').trim(),
      (r[2] || 'Phương án B').trim(),
      (r[3] || 'Phương án C').trim(),
      (r[4] || 'Phương án D').trim(),
    ];
    let correctIndex = letterToIndex(r[5] || 'A');
    if (correctIndex < 0) {
      correctIndex = 0;
      warnings.push(`Dòng ${i + 1} CSV chưa hợp lệ cột đáp án đúng, tạm chọn A.`);
    }
    const explanation = (r[6] || '').trim();

    questions.push({
      id: makeId(),
      text,
      options,
      correctIndex,
      explanation,
    });
  }

  return { questions, warnings };
}

export function parseJsonQuestions(rawJson: string): ParsedQuizResult {
  const warnings: string[] = [];
  try {
    const parsed = JSON.parse(rawJson);
    let rawList: unknown[] = [];
    let titleSuggestion: string | undefined;
    let descriptionSuggestion: string | undefined;
    let timeLimitSuggestion: number | undefined;

    if (Array.isArray(parsed)) {
      rawList = parsed;
    } else if (parsed && typeof parsed === 'object') {
      const obj = parsed as Record<string, unknown>;
      if (typeof obj.title === 'string') titleSuggestion = obj.title;
      if (typeof obj.description === 'string') descriptionSuggestion = obj.description;
      if (typeof obj.timeLimitMinutes === 'number') timeLimitSuggestion = obj.timeLimitMinutes;
      if (Array.isArray(obj.questions)) {
        rawList = obj.questions;
      }
    }

    const questions: Question[] = [];
    rawList.forEach((item, idx) => {
      if (!item || typeof item !== 'object') return;
      const q = item as Record<string, unknown>;
      const text = String(q.text ?? q.question ?? '').trim();
      const rawOpts = Array.isArray(q.options) ? q.options.map((x) => String(x).trim()) : [];
      if (!text || rawOpts.length < 2) {
        warnings.push(`Mục JSON #${idx + 1} thiếu nội dung câu hỏi hoặc đáp án.`);
        return;
      }
      const options: [string, string, string, string] = [
        rawOpts[0] || 'Phương án A',
        rawOpts[1] || 'Phương án B',
        rawOpts[2] || 'Phương án C',
        rawOpts[3] || 'Phương án D',
      ];
      let correctIndex = 0;
      if (typeof q.correctIndex === 'number' && q.correctIndex >= 0 && q.correctIndex <= 3) {
        correctIndex = q.correctIndex;
      } else if (typeof q.answer === 'string') {
        const idxFromLetter = letterToIndex(q.answer);
        if (idxFromLetter >= 0) correctIndex = idxFromLetter;
      }
      const explanation = String(q.explanation ?? '').trim();
      questions.push({
        id: makeId(),
        text,
        options,
        correctIndex,
        explanation,
      });
    });

    return {
      titleSuggestion,
      descriptionSuggestion,
      timeLimitSuggestion,
      questions,
      warnings,
    };
  } catch {
    return {
      questions: [],
      warnings: ['Cấu trúc JSON không hợp lệ. Vui lòng kiểm tra lại định dạng dấu ngoặc kép và dấu phẩy.'],
    };
  }
}

export async function parseQuizFile(file: File): Promise<ParsedQuizResult> {
  const lowerName = file.name.toLowerCase();

  if (lowerName.endsWith('.docx')) {
    const buffer = await file.arrayBuffer();
    const result = await mammoth.extractRawText({ arrayBuffer: buffer });
    return parseStructuredTextQuestions(result.value);
  }

  if (lowerName.endsWith('.json')) {
    const text = await file.text();
    return parseJsonQuestions(text);
  }

  if (lowerName.endsWith('.csv')) {
    const text = await file.text();
    return parseCsvQuestions(text);
  }

  if (lowerName.endsWith('.txt')) {
    const text = await file.text();
    return parseStructuredTextQuestions(text);
  }

  return {
    questions: [],
    warnings: ['Định dạng tệp chưa được hỗ trợ. Vui lòng chọn tệp .docx, .txt, .csv hoặc .json.'],
  };
}

export const SAMPLE_TXT_TEMPLATE = `Câu 1: Trong soạn thảo văn bản hành chính quân sự, phông chữ chuẩn theo quy định hiện hành là gì?
A. Arial
B. Times New Roman
C. Calibri
D. Tahoma
Đáp án: B
Giải thích: Văn bản hành chính sử dụng bảng mã Unicode và phông chữ Times New Roman.

Câu 2: Tổ hợp phím nào dùng để khóa nhanh màn hình máy tính Windows khi rời vị trí công tác?
A. Ctrl + Alt + Del
B. Alt + F4
C. Windows + L
D. Ctrl + S
Đáp án: C
Giải thích: Windows + L khóa ngay màn hình làm việc giúp bảo vệ dữ liệu và tài khoản.`;

export const SAMPLE_CSV_TEMPLATE = `Câu hỏi,Đáp án A,Đáp án B,Đáp án C,Đáp án D,Đáp án đúng,Giải thích
"Trong bảng tính Excel, hàm nào tính trung bình cộng?","=SUM(A1:A5)","=AVERAGE(A1:A5)","=COUNT(A1:A5)","=MAX(A1:A5)","B","Hàm AVERAGE dùng để tính giá trị trung bình cộng."
"Ngày truyền thống của Bộ đội Pháo binh Việt Nam là ngày nào?","22/12/1944","29/06/1946","19/12/1946","07/05/1954","B","Ngày 29/06/1946 là Ngày truyền thống Bộ đội Pháo binh Việt Nam."`;

export const SAMPLE_JSON_TEMPLATE = `{
  "title": "Bộ đề ôn tập Chuyển đổi số & Điều lệnh",
  "description": "Đề kiểm tra tổng hợp kiến thức tin học và điều lệnh quân nhân.",
  "timeLimitMinutes": 10,
  "questions": [
    {
      "text": "Tổ hợp phím nào trong Word dùng để lưu nhanh tệp văn bản?",
      "options": ["Ctrl + P", "Ctrl + S", "Ctrl + C", "Ctrl + V"],
      "correctIndex": 1,
      "explanation": "Ctrl + S là phím tắt lưu tài liệu đang mở."
    },
    {
      "text": "Thang điểm 10 đạt mức Giỏi khi điểm số từ bao nhiêu trở lên?",
      "options": ["Từ 5 điểm", "Từ 6.5 điểm", "Từ 8 điểm", "Từ 9 điểm"],
      "correctIndex": 2,
      "explanation": "Thang phân loại 4 mức: Giỏi từ 8 điểm trở lên, Khá từ 6.5 đến dưới 8, Đạt từ 5 đến dưới 6.5, Yếu dưới 5 điểm."
    }
  ]
}`;
