import React, { useMemo, useRef, useState } from 'react';
import { AnimatePresence, motion } from 'motion/react';
import {
  AlertCircle,
  BookOpen,
  Check,
  Cloud,
  CloudOff,
  Database,
  Download,
  Edit3,
  Eye,
  FileSpreadsheet,
  FileText,
  FileUp,
  Lock,
  LogOut,
  Plus,
  RefreshCw,
  Save,
  ShieldCheck,
  Trash2,
  Unlock,
  Upload,
  UserPlus,
  Users,
  X,
} from 'lucide-react';
import {
  CandidateSummary,
  CloudStorageState,
  Question,
  QuizAttempt,
  SystemBackupPayload,
  Topic,
  UserAccount,
  UserRole,
} from '../types';
import {
  ParsedQuizResult,
  SAMPLE_CSV_TEMPLATE,
  SAMPLE_JSON_TEMPLATE,
  SAMPLE_TXT_TEMPLATE,
  parseQuizFile,
  parseStructuredTextQuestions,
} from '../utils/fileParser';
import {
  downloadTextFile,
  exportAccountsBackup,
  exportFullBackup,
} from '../utils/storage';
import { formatDateTime, groupAttemptsByCandidate } from '../utils/grading';
import { CandidateDetailModal } from './CandidateDetailModal';

interface AdminPanelProps {
  currentUser: UserAccount;
  accounts: UserAccount[];
  topics: Topic[];
  attempts: QuizAttempt[];
  cloud: CloudStorageState;
  onUpdateAccounts: (accounts: UserAccount[]) => void;
  onUpdateTopics: (topics: Topic[]) => void;
  onUpdateAttempts: (attempts: QuizAttempt[]) => void;
  onConnectCloud: () => Promise<void>;
  onDisconnectCloud: () => Promise<void>;
  onSyncCloudNow: () => Promise<void>;
}

type AdminSubTab = 'accounts' | 'topics' | 'storage';
type ExampleFormat = 'txt' | 'csv' | 'json' | 'docx';

const OPTION_LETTERS = ['A', 'B', 'C', 'D'] as const;
const EASE_SMOOTH = [0.16, 1, 0.3, 1] as const;

export const AdminPanel: React.FC<AdminPanelProps> = ({
  currentUser,
  accounts,
  topics,
  attempts,
  cloud,
  onUpdateAccounts,
  onUpdateTopics,
  onUpdateAttempts,
  onConnectCloud,
  onDisconnectCloud,
  onSyncCloudNow,
}) => {
  const [subTab, setSubTab] = useState<AdminSubTab>('accounts');
  const [notice, setNotice] = useState<{ type: 'success' | 'error'; text: string } | null>(null);

  // Account management state
  const [editingAccountId, setEditingAccountId] = useState<string | null>(null);
  const [accUsername, setAccUsername] = useState('');
  const [accPassword, setAccPassword] = useState('');
  const [accFullName, setAccFullName] = useState('');
  const [accDefaultUnit, setAccDefaultUnit] = useState('');
  const [accRole, setAccRole] = useState<UserRole>('student');
  const [accActive, setAccActive] = useState(true);
  const [confirmDeleteAccId, setConfirmDeleteAccId] = useState<string | null>(null);

  const backupInputRef = useRef<HTMLInputElement | null>(null);

  // Topic & Question management state
  const [selectedTopicId, setSelectedTopicId] = useState<string>(topics[0]?.id || '');
  const [showTopicModal, setShowTopicModal] = useState<'create' | 'edit' | null>(null);
  const [topicCode, setTopicCode] = useState('');
  const [topicTitle, setTopicTitle] = useState('');
  const [topicDescription, setTopicDescription] = useState('');
  const [topicMinutes, setTopicMinutes] = useState(15);
  const [confirmDeleteTopic, setConfirmDeleteTopic] = useState(false);

  // File upload parsing state
  const quizFileInputRef = useRef<HTMLInputElement | null>(null);
  const [isParsingFile, setIsParsingFile] = useState(false);
  const [parsedPreview, setParsedPreview] = useState<{
    fileName: string;
    result: ParsedQuizResult;
    targetMode: 'append' | 'replace' | 'new_topic';
    newTopicTitle: string;
  } | null>(null);

  // Form Tổng Hợp Toàn Bộ Câu Hỏi & Ví Dụ
  const [singleQId, setSingleQId] = useState<string | null>(null);
  const [singleQText, setSingleQText] = useState('');
  const [singleQOpts, setSingleQOpts] = useState<[string, string, string, string]>([
    '',
    '',
    '',
    '',
  ]);
  const [singleQCorrect, setSingleQCorrect] = useState(0);
  const [singleQExplain, setSingleQExplain] = useState('');

  const [bulkFormText, setBulkFormText] = useState('');
  const [exampleFormat, setExampleFormat] = useState<ExampleFormat>('txt');
  const [confirmClearAttempts, setConfirmClearAttempts] = useState(false);
  const [attemptAccountFilter, setAttemptAccountFilter] = useState<string>('ALL');
  const [confirmDeleteCandidateKey, setConfirmDeleteCandidateKey] = useState<string | null>(null);
  const [selectedCandidateKey, setSelectedCandidateKey] = useState<string | null>(null);

  const attemptAccountOptions = useMemo(() => {
    const names = new Set<string>();
    for (const acc of accounts) names.add(acc.username);
    for (const att of attempts) {
      if (att.accountUsername) names.add(att.accountUsername);
    }
    return Array.from(names).sort((a, b) => a.localeCompare(b));
  }, [accounts, attempts]);

  const filteredAdminAttempts = useMemo(() => {
    const list =
      attemptAccountFilter === 'ALL'
        ? attempts
        : attempts.filter(
            (a) => a.accountUsername.toLowerCase() === attemptAccountFilter.toLowerCase()
          );
    return [...list].sort(
      (a, b) => new Date(b.submittedAt).getTime() - new Date(a.submittedAt).getTime()
    );
  }, [attempts, attemptAccountFilter]);

  const groupedAdminCandidates = useMemo(() => {
    return groupAttemptsByCandidate(filteredAdminAttempts).sort(
      (a, b) =>
        new Date(b.latestSubmittedAt).getTime() - new Date(a.latestSubmittedAt).getTime()
    );
  }, [filteredAdminAttempts]);

  const selectedAdminCandidate: CandidateSummary | null = useMemo(() => {
    if (!selectedCandidateKey) return null;
    return groupedAdminCandidates.find((c) => c.key === selectedCandidateKey) || null;
  }, [groupedAdminCandidates, selectedCandidateKey]);

  const selectedTopic = useMemo(
    () => topics.find((t) => t.id === selectedTopicId) || topics[0] || null,
    [topics, selectedTopicId]
  );

  const showToast = (type: 'success' | 'error', text: string) => {
    setNotice({ type, text });
  };

  // ==================== ACCOUNT HANDLERS ====================
  const resetAccountForm = () => {
    setEditingAccountId(null);
    setAccUsername('');
    setAccPassword('');
    setAccFullName('');
    setAccDefaultUnit('');
    setAccRole('student');
    setAccActive(true);
  };

  const startEditAccount = (acc: UserAccount) => {
    setEditingAccountId(acc.id);
    setAccUsername(acc.username);
    setAccPassword(acc.password);
    setAccFullName(acc.fullName);
    setAccDefaultUnit(acc.defaultUnit);
    setAccRole(acc.role);
    setAccActive(acc.active);
    setNotice(null);
  };

  const handleSaveAccount = (e: React.FormEvent) => {
    e.preventDefault();
    const uname = accUsername.trim();
    const pwd = accPassword.trim();
    if (!uname || !pwd) {
      showToast('error', 'Tên đăng nhập và mật khẩu không được để trống.');
      return;
    }

    const now = new Date().toISOString();

    if (editingAccountId) {
      const duplicate = accounts.some(
        (a) =>
          a.id !== editingAccountId && a.username.toLowerCase() === uname.toLowerCase()
      );
      if (duplicate) {
        showToast('error', `Tên đăng nhập "${uname}" đã tồn tại.`);
        return;
      }
      const updated = accounts.map((a) =>
        a.id === editingAccountId
          ? {
              ...a,
              username: uname,
              password: pwd,
              fullName: accFullName.trim(),
              defaultUnit: accDefaultUnit.trim(),
              role: a.username.toLowerCase() === 'admin' ? 'admin' : accRole,
              active: a.username.toLowerCase() === 'admin' ? true : accActive,
              updatedAt: now,
            }
          : a
      );
      onUpdateAccounts(updated);
      resetAccountForm();
      showToast('success', `Đã cập nhật tài khoản "${uname}" vào localStorage.`);
    } else {
      const duplicate = accounts.some(
        (a) => a.username.toLowerCase() === uname.toLowerCase()
      );
      if (duplicate) {
        showToast('error', `Tài khoản "${uname}" đã tồn tại trong hệ thống.`);
        return;
      }
      const newAcc: UserAccount = {
        id: `acc-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`,
        username: uname,
        password: pwd,
        fullName: accFullName.trim(),
        defaultUnit: accDefaultUnit.trim(),
        role: accRole,
        active: accActive,
        createdAt: now,
        updatedAt: now,
      };
      onUpdateAccounts([...accounts, newAcc]);
      resetAccountForm();
      showToast('success', `Đã cấp tài khoản mới "${uname}" và lưu vĩnh viễn.`);
    }
  };

  const handleToggleLock = (acc: UserAccount) => {
    if (acc.username.toLowerCase() === 'admin') {
      showToast('error', 'Không thể khóa tài khoản quản trị gốc.');
      return;
    }
    const updated = accounts.map((a) =>
      a.id === acc.id ? { ...a, active: !a.active, updatedAt: new Date().toISOString() } : a
    );
    onUpdateAccounts(updated);
    showToast(
      'success',
      acc.active ? `Đã khóa tài khoản "${acc.username}".` : `Đã mở khóa "${acc.username}".`
    );
  };

  const handleDeleteAccount = (acc: UserAccount) => {
    if (acc.username.toLowerCase() === 'admin' || acc.id === currentUser.id) {
      showToast('error', 'Không thể xóa tài khoản quản trị đang đăng nhập.');
      return;
    }
    onUpdateAccounts(accounts.filter((a) => a.id !== acc.id));
    setConfirmDeleteAccId(null);
    if (editingAccountId === acc.id) resetAccountForm();
    showToast('success', `Đã xóa tài khoản "${acc.username}".`);
  };

  const handleExportAccounts = () => {
    const json = exportAccountsBackup(accounts);
    const stamp = new Date().toISOString().slice(0, 10);
    downloadTextFile(`saoluu_taikhoan_${stamp}.json`, json);
    showToast('success', 'Đã xuất tệp sao lưu danh sách tài khoản.');
  };

  const handleExportFull = () => {
    const json = exportFullBackup(accounts, topics, attempts);
    const stamp = new Date().toISOString().slice(0, 10);
    downloadTextFile(`saoluu_toanbo_490_${stamp}.json`, json);
    showToast('success', 'Đã xuất tệp sao lưu toàn bộ tài khoản, bộ đề và lịch sử thi.');
  };

  const handleImportBackup = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    e.target.value = '';
    if (!file) return;

    try {
      const text = await file.text();
      const parsed = JSON.parse(text) as Partial<SystemBackupPayload> | UserAccount[];

      let importedAccounts: UserAccount[] = [];
      let importedTopics: Topic[] | undefined;
      let importedAttempts: QuizAttempt[] | undefined;

      if (Array.isArray(parsed)) {
        importedAccounts = parsed;
      } else if (parsed && typeof parsed === 'object') {
        if (Array.isArray(parsed.accounts)) importedAccounts = parsed.accounts;
        if (Array.isArray(parsed.topics)) importedTopics = parsed.topics;
        if (Array.isArray(parsed.attempts)) importedAttempts = parsed.attempts;
      }

      if (importedAccounts.length === 0 && !importedTopics && !importedAttempts) {
        showToast('error', 'Tệp sao lưu không chứa dữ liệu tài khoản hoặc bộ đề hợp lệ.');
        return;
      }

      if (importedAccounts.length > 0) {
        const mergedMap = new Map<string, UserAccount>();
        for (const acc of accounts) {
          mergedMap.set(acc.username.toLowerCase(), acc);
        }
        for (const inc of importedAccounts) {
          if (inc.username && inc.password) {
            mergedMap.set(inc.username.toLowerCase(), {
              id: inc.id || `acc-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`,
              username: inc.username.trim(),
              password: String(inc.password),
              fullName: String(inc.fullName || ''),
              defaultUnit: String(inc.defaultUnit || ''),
              role: inc.role === 'admin' ? 'admin' : 'student',
              active: inc.active !== false,
              createdAt: inc.createdAt || new Date().toISOString(),
              updatedAt: new Date().toISOString(),
            });
          }
        }
        onUpdateAccounts(Array.from(mergedMap.values()));
      }

      if (importedTopics && importedTopics.length > 0) {
        onUpdateTopics(importedTopics);
        setSelectedTopicId(importedTopics[0].id);
      }

      if (importedAttempts && importedAttempts.length > 0) {
        onUpdateAttempts(importedAttempts);
      }

      showToast(
        'success',
        `Đã nạp dữ liệu thành công (${importedAccounts.length} tài khoản${
          importedTopics ? `, ${importedTopics.length} chuyên đề` : ''
        }${importedAttempts ? `, ${importedAttempts.length} lượt thi` : ''}).`
      );
    } catch {
      showToast('error', 'Không thể đọc tệp JSON sao lưu. Vui lòng kiểm tra định dạng tệp.');
    }
  };

  // ==================== TOPIC & QUESTION HANDLERS ====================
  const openCreateTopic = () => {
    setTopicCode(`CD-${String(topics.length + 1).padStart(2, '0')}`);
    setTopicTitle('');
    setTopicDescription('');
    setTopicMinutes(15);
    setShowTopicModal('create');
  };

  const openEditTopic = () => {
    if (!selectedTopic) return;
    setTopicCode(selectedTopic.code);
    setTopicTitle(selectedTopic.title);
    setTopicDescription(selectedTopic.description);
    setTopicMinutes(selectedTopic.timeLimitMinutes);
    setShowTopicModal('edit');
  };

  const handleSaveTopicModal = (e: React.FormEvent) => {
    e.preventDefault();
    if (!topicTitle.trim()) {
      showToast('error', 'Tên chuyên đề không được để trống.');
      return;
    }
    const now = new Date().toISOString();
    if (showTopicModal === 'create') {
      const newTopic: Topic = {
        id: `topic-${Date.now()}`,
        code: topicCode.trim() || `CD-${topics.length + 1}`,
        title: topicTitle.trim(),
        description: topicDescription.trim(),
        timeLimitMinutes: Math.max(1, Number(topicMinutes) || 15),
        questions: [],
        createdAt: now,
        updatedAt: now,
      };
      const next = [...topics, newTopic];
      onUpdateTopics(next);
      setSelectedTopicId(newTopic.id);
      setShowTopicModal(null);
      showToast('success', `Đã tạo chuyên đề "${newTopic.title}".`);
    } else if (showTopicModal === 'edit' && selectedTopic) {
      const next = topics.map((t) =>
        t.id === selectedTopic.id
          ? {
              ...t,
              code: topicCode.trim() || t.code,
              title: topicTitle.trim(),
              description: topicDescription.trim(),
              timeLimitMinutes: Math.max(1, Number(topicMinutes) || 15),
              updatedAt: now,
            }
          : t
      );
      onUpdateTopics(next);
      setShowTopicModal(null);
      showToast('success', 'Đã cập nhật thông tin chuyên đề.');
    }
  };

  const handleDeleteCurrentTopic = () => {
    if (!selectedTopic) return;
    const remaining = topics.filter((t) => t.id !== selectedTopic.id);
    onUpdateTopics(remaining);
    setSelectedTopicId(remaining[0]?.id || '');
    setConfirmDeleteTopic(false);
    showToast('success', `Đã xóa chuyên đề "${selectedTopic.title}".`);
  };

  // ==================== FILE UPLOAD (.docx, .txt, .csv, .json) ====================
  const handleQuizFileSelected = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    e.target.value = '';
    if (!file) return;

    setIsParsingFile(true);
    setNotice(null);
    try {
      const result = await parseQuizFile(file);
      if (result.questions.length === 0) {
        showToast(
          'error',
          result.warnings[0] || 'Không trích xuất được câu hỏi nào từ tệp đã chọn.'
        );
      } else {
        const cleanFileTitle = file.name.replace(/\.(docx|txt|csv|json)$/i, '');
        setParsedPreview({
          fileName: file.name,
          result,
          targetMode: selectedTopic ? 'append' : 'new_topic',
          newTopicTitle: result.titleSuggestion || cleanFileTitle,
        });
      }
    } catch {
      showToast('error', 'Có lỗi xảy ra khi đọc tệp đề thi.');
    } finally {
      setIsParsingFile(false);
    }
  };

  const handleConfirmImportParsed = () => {
    if (!parsedPreview) return;
    const { result, targetMode, newTopicTitle } = parsedPreview;
    const now = new Date().toISOString();

    if (targetMode === 'new_topic' || !selectedTopic) {
      const newTopic: Topic = {
        id: `topic-${Date.now()}`,
        code: `CD-${String(topics.length + 1).padStart(2, '0')}`,
        title: newTopicTitle.trim() || 'Chuyên đề nhập từ tệp',
        description:
          result.descriptionSuggestion ||
          `Bộ đề nhập từ tệp ${parsedPreview.fileName} (${result.questions.length} câu).`,
        timeLimitMinutes: result.timeLimitSuggestion || 15,
        questions: result.questions,
        createdAt: now,
        updatedAt: now,
      };
      onUpdateTopics([...topics, newTopic]);
      setSelectedTopicId(newTopic.id);
      showToast(
        'success',
        `Đã tạo chuyên đề "${newTopic.title}" với ${result.questions.length} câu hỏi.`
      );
    } else {
      const updated = topics.map((t) => {
        if (t.id !== selectedTopic.id) return t;
        const nextQuestions =
          targetMode === 'replace'
            ? result.questions
            : [...t.questions, ...result.questions];
        return { ...t, questions: nextQuestions, updatedAt: now };
      });
      onUpdateTopics(updated);
      showToast(
        'success',
        `Đã nạp ${result.questions.length} câu hỏi vào chuyên đề "${selectedTopic.title}".`
      );
    }
    setParsedPreview(null);
  };

  // ==================== FORM TỔNG HỢP CÂU HỎI ====================
  const resetSingleQuestionForm = () => {
    setSingleQId(null);
    setSingleQText('');
    setSingleQOpts(['', '', '', '']);
    setSingleQCorrect(0);
    setSingleQExplain('');
  };

  const handleEditQuestion = (q: Question) => {
    setSingleQId(q.id);
    setSingleQText(q.text);
    setSingleQOpts([...q.options] as [string, string, string, string]);
    setSingleQCorrect(q.correctIndex);
    setSingleQExplain(q.explanation);
  };

  const handleSaveSingleQuestion = (e: React.FormEvent) => {
    e.preventDefault();
    if (!selectedTopic) {
      showToast('error', 'Vui lòng tạo hoặc chọn một chuyên đề trước.');
      return;
    }
    if (!singleQText.trim() || singleQOpts.some((o) => !o.trim())) {
      showToast('error', 'Vui lòng nhập đầy đủ nội dung câu hỏi và cả 4 đáp án A, B, C, D.');
      return;
    }

    const cleanOpts: [string, string, string, string] = [
      singleQOpts[0].trim(),
      singleQOpts[1].trim(),
      singleQOpts[2].trim(),
      singleQOpts[3].trim(),
    ];

    const updatedTopics = topics.map((t) => {
      if (t.id !== selectedTopic.id) return t;
      let nextQuestions: Question[];
      if (singleQId) {
        nextQuestions = t.questions.map((q) =>
          q.id === singleQId
            ? {
                ...q,
                text: singleQText.trim(),
                options: cleanOpts,
                correctIndex: singleQCorrect,
                explanation: singleQExplain.trim(),
              }
            : q
        );
      } else {
        const newQ: Question = {
          id: `q-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`,
          text: singleQText.trim(),
          options: cleanOpts,
          correctIndex: singleQCorrect,
          explanation: singleQExplain.trim(),
        };
        nextQuestions = [...t.questions, newQ];
      }
      return { ...t, questions: nextQuestions, updatedAt: new Date().toISOString() };
    });

    onUpdateTopics(updatedTopics);
    showToast(
      'success',
      singleQId ? 'Đã cập nhật câu hỏi.' : 'Đã thêm câu hỏi mới vào chuyên đề.'
    );
    resetSingleQuestionForm();
  };

  const handleDeleteQuestion = (questionId: string) => {
    if (!selectedTopic) return;
    const updated = topics.map((t) =>
      t.id === selectedTopic.id
        ? {
            ...t,
            questions: t.questions.filter((q) => q.id !== questionId),
            updatedAt: new Date().toISOString(),
          }
        : t
    );
    onUpdateTopics(updated);
    if (singleQId === questionId) resetSingleQuestionForm();
    showToast('success', 'Đã xóa câu hỏi khỏi chuyên đề.');
  };

  const handleBulkParseAndAdd = () => {
    if (!selectedTopic) {
      showToast('error', 'Vui lòng tạo hoặc chọn một chuyên đề trước.');
      return;
    }
    const parsed = parseStructuredTextQuestions(bulkFormText);
    if (parsed.questions.length === 0) {
      showToast(
        'error',
        parsed.warnings[0] ||
          'Không nhận diện được câu hỏi. Vui lòng xem mẫu chuẩn ở khung Ví dụ bên cạnh.'
      );
      return;
    }
    const updated = topics.map((t) =>
      t.id === selectedTopic.id
        ? {
            ...t,
            questions: [...t.questions, ...parsed.questions],
            updatedAt: new Date().toISOString(),
          }
        : t
    );
    onUpdateTopics(updated);
    setBulkFormText('');
    showToast(
      'success',
      `Đã phân tích và nạp ${parsed.questions.length} câu hỏi từ Form Tổng Hợp.`
    );
  };

  const handleExportCurrentTopicText = () => {
    if (!selectedTopic) return;
    const text = selectedTopic.questions
      .map((q, idx) => {
        const lines = [
          `Câu ${idx + 1}: ${q.text}`,
          `A. ${q.options[0]}`,
          `B. ${q.options[1]}`,
          `C. ${q.options[2]}`,
          `D. ${q.options[3]}`,
          `Đáp án: ${OPTION_LETTERS[q.correctIndex]}`,
        ];
        if (q.explanation) lines.push(`Giải thích: ${q.explanation}`);
        return lines.join('\n');
      })
      .join('\n\n');
    downloadTextFile(`${selectedTopic.code || 'bode'}.txt`, text, 'text/plain;charset=utf-8');
  };

  const handleLoadAllQuestionsToBulkForm = () => {
    if (!selectedTopic || selectedTopic.questions.length === 0) {
      setBulkFormText(SAMPLE_TXT_TEMPLATE);
      return;
    }
    const text = selectedTopic.questions
      .map((q, idx) => {
        const lines = [
          `Câu ${idx + 1}: ${q.text}`,
          `A. ${q.options[0]}`,
          `B. ${q.options[1]}`,
          `C. ${q.options[2]}`,
          `D. ${q.options[3]}`,
          `Đáp án: ${OPTION_LETTERS[q.correctIndex]}`,
        ];
        if (q.explanation) lines.push(`Giải thích: ${q.explanation}`);
        return lines.join('\n');
      })
      .join('\n\n');
    setBulkFormText(text);
  };

  return (
    <section className="space-y-6">
      {/* Header */}
      <div className="flex flex-col sm:flex-row sm:items-end justify-between gap-4 border-b border-[#DDE3DC] pb-5">
        <div>
          <p className="text-xs font-semibold tracking-wider uppercase text-[#8C6516] mb-1">
            Phân quyền Quản trị viên · {currentUser.username}
          </p>
          <h2 className="text-2xl sm:text-3xl font-bold text-[#152019] tracking-tight">
            Quản Trị Hệ Thống
          </h2>
        </div>

        <div className="inline-flex items-center p-1 bg-[#E7ECE7] rounded-lg self-start sm:self-auto">
          <button
            type="button"
            onClick={() => {
              setSubTab('accounts');
              setNotice(null);
            }}
            className={`relative inline-flex items-center gap-2 px-4 py-2 text-xs sm:text-sm font-semibold rounded-md transition-colors whitespace-nowrap cursor-pointer ${
              subTab === 'accounts'
                ? 'text-[#1F4D36]'
                : 'text-[#4B5B50] hover:text-[#152019]'
            }`}
          >
            {subTab === 'accounts' && (
              <motion.span
                layoutId="admin-subtab-pill"
                transition={{ duration: 0.2, ease: EASE_SMOOTH }}
                className="absolute inset-0 bg-white rounded-md shadow-sm"
              />
            )}
            <Users className="w-4 h-4 relative z-10" />
            <span className="relative z-10">Tài khoản & Sao lưu</span>
          </button>
          <button
            type="button"
            onClick={() => {
              setSubTab('topics');
              setNotice(null);
            }}
            className={`relative inline-flex items-center gap-2 px-4 py-2 text-xs sm:text-sm font-semibold rounded-md transition-colors whitespace-nowrap cursor-pointer ${
              subTab === 'topics'
                ? 'text-[#1F4D36]'
                : 'text-[#4B5B50] hover:text-[#152019]'
            }`}
          >
            {subTab === 'topics' && (
              <motion.span
                layoutId="admin-subtab-pill"
                transition={{ duration: 0.2, ease: EASE_SMOOTH }}
                className="absolute inset-0 bg-white rounded-md shadow-sm"
              />
            )}
            <BookOpen className="w-4 h-4 relative z-10" />
            <span className="relative z-10">Bộ đề & Đẩy đề từ file</span>
          </button>
          <button
            type="button"
            onClick={() => {
              setSubTab('storage');
              setNotice(null);
            }}
            className={`relative inline-flex items-center gap-2 px-4 py-2 text-xs sm:text-sm font-semibold rounded-md transition-colors whitespace-nowrap cursor-pointer ${
              subTab === 'storage'
                ? 'text-[#1F4D36]'
                : 'text-[#4B5B50] hover:text-[#152019]'
            }`}
          >
            {subTab === 'storage' && (
              <motion.span
                layoutId="admin-subtab-pill"
                transition={{ duration: 0.2, ease: EASE_SMOOTH }}
                className="absolute inset-0 bg-white rounded-md shadow-sm"
              />
            )}
            <Database className="w-4 h-4 relative z-10" />
            <span className="relative z-10">Lưu trữ dữ liệu</span>
          </button>
        </div>
      </div>

      {/* Inline Toast Feedback */}
      <AnimatePresence>
        {notice && (
          <motion.div
            initial={{ opacity: 0, y: -8 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0, y: -8 }}
            transition={{ duration: 0.18, ease: EASE_SMOOTH }}
            role="status"
            className={`flex items-center justify-between gap-3 px-4 py-3 rounded-xl border text-sm font-medium ${
              notice.type === 'success'
                ? 'bg-[#ECFDF5] border-[#BBF7D0] text-[#166534]'
                : 'bg-[#FEF2F2] border-[#FECACA] text-[#B91C1C]'
            }`}
          >
            <div className="flex items-center gap-2">
              {notice.type === 'success' ? (
                <Check className="w-4 h-4 shrink-0" />
              ) : (
                <AlertCircle className="w-4 h-4 shrink-0" />
              )}
              <span>{notice.text}</span>
            </div>
            <button
              type="button"
              onClick={() => setNotice(null)}
              className="p-1 hover:opacity-75 cursor-pointer"
            >
              <X className="w-4 h-4" />
            </button>
          </motion.div>
        )}
      </AnimatePresence>

      {/* Shared hidden JSON backup file input */}
      <input
        ref={backupInputRef}
        type="file"
        accept=".json"
        onChange={handleImportBackup}
        className="hidden"
      />

      {/* ==================== TAB 1: QUẢN LÝ TÀI KHOẢN & SAO LƯU ==================== */}
      {subTab === 'accounts' && (
        <div className="grid grid-cols-1 lg:grid-cols-12 gap-6 items-start">
          {/* Left: Create/Edit Account Form & Backup Tools */}
          <div className="lg:col-span-4 space-y-6">
            <div className="bg-white border border-[#DDE3DC] rounded-xl p-6">
              <h3 className="text-base font-bold text-[#152019] flex items-center gap-2 mb-4">
                <UserPlus className="w-4 h-4 text-[#1F4D36]" />
                <span>{editingAccountId ? 'Chỉnh sửa tài khoản' : 'Cấp tài khoản mới'}</span>
              </h3>

              <form onSubmit={handleSaveAccount} className="space-y-4">
                <div>
                  <label className="block text-xs font-semibold text-[#243329] mb-1">
                    Tên đăng nhập <span className="text-[#B91C1C]">*</span>
                  </label>
                  <input
                    type="text"
                    value={accUsername}
                    disabled={
                      Boolean(editingAccountId) && accUsername.toLowerCase() === 'admin'
                    }
                    onChange={(e) => setAccUsername(e.target.value)}
                    placeholder="VD: hocvien03"
                    className="w-full px-3.5 py-2 bg-[#FAFBF9] border border-[#CFD8CE] rounded-lg text-sm text-[#152019] focus:outline-none focus:ring-2 focus:ring-[#1F4D36]/25 focus:border-[#1F4D36] disabled:opacity-60"
                  />
                </div>

                <div>
                  <label className="block text-xs font-semibold text-[#243329] mb-1">
                    Mật khẩu <span className="text-[#B91C1C]">*</span>
                  </label>
                  <input
                    type="text"
                    value={accPassword}
                    onChange={(e) => setAccPassword(e.target.value)}
                    placeholder="Nhập mật khẩu"
                    className="w-full px-3.5 py-2 bg-[#FAFBF9] border border-[#CFD8CE] rounded-lg text-sm text-[#152019] focus:outline-none focus:ring-2 focus:ring-[#1F4D36]/25 focus:border-[#1F4D36]"
                  />
                </div>

                <div>
                  <label className="block text-xs font-semibold text-[#243329] mb-1">
                    Tên hiển thị / Nhóm tài khoản
                  </label>
                  <input
                    type="text"
                    value={accFullName}
                    onChange={(e) => setAccFullName(e.target.value)}
                    placeholder="VD: Tài khoản học viên Đại đội 9"
                    className="w-full px-3.5 py-2 bg-[#FAFBF9] border border-[#CFD8CE] rounded-lg text-sm text-[#152019] focus:outline-none focus:ring-2 focus:ring-[#1F4D36]/25 focus:border-[#1F4D36]"
                  />
                </div>

                <div>
                  <label className="block text-xs font-semibold text-[#243329] mb-1">
                    Đơn vị công tác
                  </label>
                  <input
                    type="text"
                    value={accDefaultUnit}
                    onChange={(e) => setAccDefaultUnit(e.target.value)}
                    placeholder="VD: Đại đội 9 - Tiểu đoàn 3"
                    className="w-full px-3.5 py-2 bg-[#FAFBF9] border border-[#CFD8CE] rounded-lg text-sm text-[#152019] focus:outline-none focus:ring-2 focus:ring-[#1F4D36]/25 focus:border-[#1F4D36]"
                  />
                </div>

                <div className="grid grid-cols-2 gap-3">
                  <div>
                    <label className="block text-xs font-semibold text-[#243329] mb-1">
                      Phân quyền
                    </label>
                    <select
                      value={accRole}
                      disabled={accUsername.toLowerCase() === 'admin'}
                      onChange={(e) => setAccRole(e.target.value as UserRole)}
                      className="w-full px-3 py-2 bg-[#FAFBF9] border border-[#CFD8CE] rounded-lg text-sm text-[#152019] focus:outline-none focus:border-[#1F4D36]"
                    >
                      <option value="student">Học viên</option>
                      <option value="admin">Admin</option>
                    </select>
                  </div>
                  <div>
                    <label className="block text-xs font-semibold text-[#243329] mb-1">
                      Trạng thái
                    </label>
                    <select
                      value={accActive ? '1' : '0'}
                      disabled={accUsername.toLowerCase() === 'admin'}
                      onChange={(e) => setAccActive(e.target.value === '1')}
                      className="w-full px-3 py-2 bg-[#FAFBF9] border border-[#CFD8CE] rounded-lg text-sm text-[#152019] focus:outline-none focus:border-[#1F4D36]"
                    >
                      <option value="1">Hoạt động</option>
                      <option value="0">Đang khóa</option>
                    </select>
                  </div>
                </div>

                <div className="pt-2 flex items-center gap-2">
                  <button
                    type="submit"
                    className="flex-1 py-2.5 px-4 bg-[#1F4D36] hover:bg-[#173B29] text-white text-sm font-semibold rounded-lg transition-colors flex items-center justify-center gap-1.5 cursor-pointer"
                  >
                    <Save className="w-4 h-4" />
                    <span>{editingAccountId ? 'Lưu cập nhật' : 'Cấp tài khoản'}</span>
                  </button>
                  {editingAccountId && (
                    <button
                      type="button"
                      onClick={resetAccountForm}
                      className="py-2.5 px-3 bg-[#F4F6F4] hover:bg-[#E7ECE7] text-[#4B5B50] text-sm font-semibold rounded-lg cursor-pointer"
                    >
                      Hủy
                    </button>
                  )}
                </div>
              </form>
            </div>

            {/* Backup & Restore Box */}
            <div className="bg-white border border-[#DDE3DC] rounded-xl p-6 space-y-3">
              <h3 className="text-base font-bold text-[#152019]">
                Sao lưu & Nạp dữ liệu
              </h3>
              <p className="text-xs text-[#4B5B50] leading-relaxed">
                Xuất tệp JSON để lưu trữ dự phòng hoặc nạp lại danh sách tài khoản đã cấp trên máy khác.
              </p>

              <div className="space-y-2.5 pt-1">
                <button
                  type="button"
                  onClick={handleExportAccounts}
                  className="w-full py-2 px-3.5 bg-[#FAFBF9] hover:bg-[#EEF5F0] border border-[#CFD8CE] rounded-lg text-xs font-semibold text-[#152019] flex items-center justify-center gap-2 transition-colors cursor-pointer"
                >
                  <Download className="w-4 h-4 text-[#1F4D36]" />
                  <span>Sao lưu Tài khoản (.json)</span>
                </button>

                <button
                  type="button"
                  onClick={handleExportFull}
                  className="w-full py-2 px-3.5 bg-[#FAFBF9] hover:bg-[#EEF5F0] border border-[#CFD8CE] rounded-lg text-xs font-semibold text-[#152019] flex items-center justify-center gap-2 transition-colors cursor-pointer"
                >
                  <Download className="w-4 h-4 text-[#8C6516]" />
                  <span>Sao lưu Toàn bộ Hệ thống (.json)</span>
                </button>

                <button
                  type="button"
                  onClick={() => backupInputRef.current?.click()}
                  className="w-full py-2 px-3.5 bg-[#1F4D36] hover:bg-[#173B29] rounded-lg text-xs font-semibold text-white flex items-center justify-center gap-2 transition-colors cursor-pointer"
                >
                  <Upload className="w-4 h-4" />
                  <span>Nạp dữ liệu từ tệp (.json)</span>
                </button>
              </div>
            </div>
          </div>

          {/* Right: Accounts Table + Recent Attempts Control */}
          <div className="lg:col-span-8 space-y-6">
            <div className="bg-white border border-[#DDE3DC] rounded-xl overflow-hidden">
              <div className="px-6 py-4 border-b border-[#DDE3DC] flex items-center justify-between bg-[#FAFBF9]">
                <h3 className="text-base font-bold text-[#152019]">
                  Danh sách tài khoản ({accounts.length})
                </h3>
                <span className="text-xs text-[#64756A]">Lưu vĩnh viễn trên trình duyệt</span>
              </div>

              <div className="overflow-x-auto">
                <table className="w-full text-left border-collapse">
                  <thead>
                    <tr className="border-b border-[#DDE3DC] text-xs font-bold uppercase tracking-wider text-[#4B5B50] bg-[#FAFBF9]">
                      <th className="py-3 px-4">Tài khoản</th>
                      <th className="py-3 px-4">Mật khẩu</th>
                      <th className="py-3 px-4">Thông tin / Đơn vị</th>
                      <th className="py-3 px-4">Trạng thái</th>
                      <th className="py-3 px-4 text-right">Thao tác</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-[#EDF1EC] text-sm">
                    {accounts.map((acc) => {
                      const isRootAdmin = acc.username.toLowerCase() === 'admin';
                      return (
                        <tr key={acc.id} className="hover:bg-[#FAFBF9]">
                          <td className="py-3.5 px-4">
                            <div className="font-bold text-[#152019]">{acc.username}</div>
                            <div className="text-xs text-[#64756A]">
                              {acc.role === 'admin' ? 'Quản trị viên' : 'Học viên'}
                            </div>
                          </td>
                          <td className="py-3.5 px-4 font-mono-num text-xs text-[#243329]">
                            {acc.password}
                          </td>
                          <td className="py-3.5 px-4">
                            <div className="font-medium text-[#152019]">
                              {acc.fullName || '—'}
                            </div>
                            <div className="text-xs text-[#64756A]">
                              {acc.defaultUnit || 'Chưa gắn đơn vị'}
                            </div>
                          </td>
                          <td className="py-3.5 px-4 text-xs font-semibold">
                            {acc.active ? (
                              <span className="text-[#166534]">Hoạt động</span>
                            ) : (
                              <span className="text-[#B91C1C]">Đã khóa</span>
                            )}
                          </td>
                          <td className="py-3.5 px-4 text-right">
                            <div className="inline-flex items-center gap-1.5">
                              <button
                                type="button"
                                onClick={() => startEditAccount(acc)}
                                title="Sửa tài khoản"
                                className="p-1.5 rounded-md text-[#1F4D36] hover:bg-[#EEF5F0] cursor-pointer"
                              >
                                <Edit3 className="w-4 h-4" />
                              </button>
                              {!isRootAdmin && (
                                <>
                                  <button
                                    type="button"
                                    onClick={() => handleToggleLock(acc)}
                                    title={acc.active ? 'Khóa tài khoản' : 'Mở khóa'}
                                    className="p-1.5 rounded-md text-[#8C6516] hover:bg-[#FFFBEB] cursor-pointer"
                                  >
                                    {acc.active ? (
                                      <Lock className="w-4 h-4" />
                                    ) : (
                                      <Unlock className="w-4 h-4" />
                                    )}
                                  </button>
                                  {confirmDeleteAccId === acc.id ? (
                                    <button
                                      type="button"
                                      onClick={() => handleDeleteAccount(acc)}
                                      className="px-2 py-1 text-xs font-bold bg-[#B91C1C] text-white rounded cursor-pointer"
                                    >
                                      Xóa
                                    </button>
                                  ) : (
                                    <button
                                      type="button"
                                      onClick={() => setConfirmDeleteAccId(acc.id)}
                                      title="Xóa tài khoản"
                                      className="p-1.5 rounded-md text-[#B91C1C] hover:bg-[#FEF2F2] cursor-pointer"
                                    >
                                      <Trash2 className="w-4 h-4" />
                                    </button>
                                  )}
                                </>
                              )}
                            </div>
                          </td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>
            </div>

            {/* Attempt records management for Admin */}
            <div className="bg-white border border-[#DDE3DC] rounded-xl overflow-hidden">
              <div className="p-5 flex flex-col lg:flex-row lg:items-center justify-between gap-4 bg-[#FAFBF9] border-b border-[#DDE3DC]">
                <div>
                  <h4 className="text-base font-bold text-[#152019]">
                    Quản lý dữ liệu lượt thi ({attempts.length} lượt)
                  </h4>
                  <p className="text-xs text-[#64756A] mt-0.5">
                    Xem danh sách các lượt thi theo từng tài khoản, xóa từng lượt hoặc làm mới toàn bộ.
                  </p>
                </div>

                <div className="flex flex-wrap items-center gap-2.5 shrink-0">
                  <select
                    aria-label="Lọc lượt thi theo tài khoản"
                    value={attemptAccountFilter}
                    onChange={(e) => setAttemptAccountFilter(e.target.value)}
                    className="px-3 py-2 bg-white border border-[#CFD8CE] rounded-lg text-xs font-semibold text-[#152019] focus:outline-none focus:border-[#1F4D36] cursor-pointer"
                  >
                    <option value="ALL">Tất cả tài khoản</option>
                    {attemptAccountOptions.map((uname) => (
                      <option key={uname} value={uname}>
                        {uname}
                      </option>
                    ))}
                  </select>

                  {confirmClearAttempts ? (
                    <div className="flex items-center gap-2 shrink-0">
                      <button
                        type="button"
                        onClick={() => setConfirmClearAttempts(false)}
                        className="px-3 py-1.5 text-xs font-semibold bg-[#F4F6F4] text-[#4B5B50] rounded-lg cursor-pointer"
                      >
                        Hủy
                      </button>
                      <button
                        type="button"
                        onClick={() => {
                          onUpdateAttempts([]);
                          setConfirmClearAttempts(false);
                          setConfirmDeleteCandidateKey(null);
                          setSelectedCandidateKey(null);
                          showToast('success', 'Đã làm mới toàn bộ dữ liệu lượt thi.');
                        }}
                        className="px-3.5 py-1.5 text-xs font-semibold bg-[#B91C1C] text-white rounded-lg cursor-pointer"
                      >
                        Xác nhận xóa hết
                      </button>
                    </div>
                  ) : (
                    <button
                      type="button"
                      disabled={attempts.length === 0}
                      onClick={() => setConfirmClearAttempts(true)}
                      className="px-4 py-2 text-xs font-semibold text-[#B91C1C] bg-[#FEF2F2] hover:bg-[#FEE2E2] border border-[#FECACA] disabled:opacity-40 rounded-lg whitespace-nowrap shrink-0 cursor-pointer"
                    >
                      Xóa toàn bộ lượt thi
                    </button>
                  )}
                </div>
              </div>

              {groupedAdminCandidates.length === 0 ? (
                <div className="p-8 text-center text-sm text-[#64756A]">
                  Chưa có lượt thi nào phù hợp với bộ lọc tài khoản hiện tại.
                </div>
              ) : (
                <>
                  {/* Mobile compact list (grouped by candidate, showing Giỏi · Khá · Đạt) */}
                  <div className="md:hidden divide-y divide-[#EDF1EC]">
                    {groupedAdminCandidates.map((person, index) => (
                      <div
                        key={person.key}
                        onClick={() => setSelectedCandidateKey(person.key)}
                        className="p-4 space-y-2.5 active:bg-[#FAFBF9] transition-colors cursor-pointer"
                      >
                        <div className="flex items-center justify-between gap-2.5">
                          <div className="flex items-center gap-2.5 min-w-0">
                            <span className="font-mono-num text-xs font-bold w-7 h-7 rounded-md bg-[#F4F6F4] border border-[#DDE3DC] text-[#1F4D36] flex items-center justify-center shrink-0">
                              #{index + 1}
                            </span>
                            <div className="min-w-0">
                              <div className="font-bold text-sm text-[#152019] truncate">
                                {person.candidateName}
                              </div>
                              <div className="text-xs text-[#64756A] truncate">
                                {person.unitNames.join(' · ') || 'Chưa rõ đơn vị'} · TK:{' '}
                                <strong className="text-[#1F4D36]">
                                  {person.accountUsernames.join(', ')}
                                </strong>
                              </div>
                            </div>
                          </div>

                          <div className="flex items-center gap-2 shrink-0">
                            <span className="font-mono-num text-xs font-bold text-[#1F4D36] whitespace-nowrap">
                              {person.totalAttempts} lần
                            </span>
                            <button
                              type="button"
                              onClick={(e) => {
                                e.stopPropagation();
                                setSelectedCandidateKey(person.key);
                              }}
                              className="inline-flex items-center gap-1 px-2.5 py-1 text-xs font-semibold text-[#1F4D36] bg-[#EEF5F0] border border-[#BFD8C7] rounded-lg whitespace-nowrap cursor-pointer"
                            >
                              <Eye className="w-3.5 h-3.5" />
                              <span>Xem</span>
                            </button>
                          </div>
                        </div>

                        <div className="flex items-center justify-between gap-2 pt-2 border-t border-[#EDF1EC]">
                          <div className="flex items-center gap-3 text-xs font-semibold tabular-nums">
                            <span className="text-[#166534] whitespace-nowrap">
                              Giỏi: {person.gioiCount}
                            </span>
                            <span className="text-[#CBD5CE]" aria-hidden="true">·</span>
                            <span className="text-[#1D4ED8] whitespace-nowrap">
                              Khá: {person.khaCount}
                            </span>
                            <span className="text-[#CBD5CE]" aria-hidden="true">·</span>
                            <span className="text-[#9A5B06] whitespace-nowrap">
                              Đạt: {person.datCount}
                            </span>
                          </div>

                          <div onClick={(e) => e.stopPropagation()} className="shrink-0">
                            {confirmDeleteCandidateKey === person.key ? (
                              <div className="flex items-center gap-1">
                                <button
                                  type="button"
                                  onClick={() => {
                                    const idsToRemove = new Set(person.attempts.map((a) => a.id));
                                    onUpdateAttempts(
                                      attempts.filter((a) => !idsToRemove.has(a.id))
                                    );
                                    setConfirmDeleteCandidateKey(null);
                                    showToast(
                                      'success',
                                      `Đã xóa toàn bộ lượt thi của "${person.candidateName}".`
                                    );
                                  }}
                                  className="px-2 py-1 text-xs font-bold bg-[#B91C1C] text-white rounded cursor-pointer"
                                >
                                  Xóa
                                </button>
                                <button
                                  type="button"
                                  onClick={() => setConfirmDeleteCandidateKey(null)}
                                  className="px-2 py-1 text-xs font-semibold bg-[#F4F6F4] text-[#4B5B50] rounded cursor-pointer"
                                >
                                  Hủy
                                </button>
                              </div>
                            ) : (
                              <button
                                type="button"
                                onClick={() => setConfirmDeleteCandidateKey(person.key)}
                                title="Xóa các lượt thi của thí sinh này"
                                className="p-1.5 rounded-md text-[#B91C1C] hover:bg-[#FEF2F2] cursor-pointer"
                              >
                                <Trash2 className="w-4 h-4" />
                              </button>
                            )}
                          </div>
                        </div>
                      </div>
                    ))}
                  </div>

                  {/* Desktop table (grouped by candidate, showing Giỏi · Khá · Đạt) */}
                  <div className="hidden md:block overflow-x-auto">
                    <table className="w-full text-left border-collapse">
                      <thead>
                        <tr className="border-b border-[#DDE3DC] text-xs font-bold uppercase tracking-wider text-[#4B5B50] bg-[#FAFBF9]">
                          <th className="py-3 px-4">Tài khoản</th>
                          <th className="py-3 px-4">Thí sinh & Đơn vị</th>
                          <th className="py-3 px-4">Số lần thi</th>
                          <th className="py-3 px-4">Xếp loại</th>
                          <th className="py-3 px-4 text-right">Thao tác</th>
                        </tr>
                      </thead>
                      <tbody className="divide-y divide-[#EDF1EC] text-sm">
                        {groupedAdminCandidates.map((person, index) => (
                          <tr
                            key={person.key}
                            onClick={() => setSelectedCandidateKey(person.key)}
                            className="hover:bg-[#FAFBF9] transition-colors cursor-pointer group"
                          >
                            <td className="py-3.5 px-4 font-semibold text-[#1F4D36] whitespace-nowrap">
                              {person.accountUsernames.join(', ')}
                            </td>
                            <td className="py-3.5 px-4">
                              <div className="flex items-center gap-2.5">
                                <span className="font-mono-num text-xs font-bold w-7 h-7 rounded bg-[#F4F6F4] border border-[#DDE3DC] text-[#1F4D36] flex items-center justify-center shrink-0">
                                  #{index + 1}
                                </span>
                                <div>
                                  <div className="font-bold text-[#152019] group-hover:text-[#1F4D36] group-hover:underline underline-offset-4">
                                    {person.candidateName}
                                  </div>
                                  <div className="text-xs text-[#64756A]">
                                    {person.unitNames.join(' · ') || 'Chưa rõ đơn vị'}
                                  </div>
                                </div>
                              </div>
                            </td>
                            <td className="py-3.5 px-4">
                              <span className="font-mono-num font-bold text-[#1F4D36] whitespace-nowrap">
                                {person.totalAttempts} lần
                              </span>
                            </td>
                            <td className="py-3.5 px-4">
                              <div className="flex items-center gap-2.5 text-xs font-semibold tabular-nums">
                                <span className="text-[#166534] whitespace-nowrap">
                                  Giỏi: {person.gioiCount}
                                </span>
                                <span className="text-[#CBD5CE]" aria-hidden="true">|</span>
                                <span className="text-[#1D4ED8] whitespace-nowrap">
                                  Khá: {person.khaCount}
                                </span>
                                <span className="text-[#CBD5CE]" aria-hidden="true">|</span>
                                <span className="text-[#9A5B06] whitespace-nowrap">
                                  Đạt: {person.datCount}
                                </span>
                              </div>
                            </td>
                            <td
                              className="py-3.5 px-4 text-right"
                              onClick={(e) => e.stopPropagation()}
                            >
                              <div className="inline-flex items-center gap-2">
                                <button
                                  type="button"
                                  onClick={() => setSelectedCandidateKey(person.key)}
                                  className="inline-flex items-center gap-1 px-3 py-1.5 text-xs font-semibold text-[#1F4D36] bg-[#EEF5F0] hover:bg-[#DCECE1] border border-[#BFD8C7] rounded-lg whitespace-nowrap cursor-pointer"
                                >
                                  <Eye className="w-3.5 h-3.5" />
                                  <span>Xem chi tiết</span>
                                </button>
                                {confirmDeleteCandidateKey === person.key ? (
                                  <div className="inline-flex items-center gap-1">
                                    <button
                                      type="button"
                                      onClick={() => {
                                        const idsToRemove = new Set(
                                          person.attempts.map((a) => a.id)
                                        );
                                        onUpdateAttempts(
                                          attempts.filter((a) => !idsToRemove.has(a.id))
                                        );
                                        setConfirmDeleteCandidateKey(null);
                                        showToast(
                                          'success',
                                          `Đã xóa các lượt thi của "${person.candidateName}".`
                                        );
                                      }}
                                      className="px-2 py-1 text-xs font-bold bg-[#B91C1C] text-white rounded cursor-pointer"
                                    >
                                      Xóa
                                    </button>
                                    <button
                                      type="button"
                                      onClick={() => setConfirmDeleteCandidateKey(null)}
                                      className="px-2 py-1 text-xs font-semibold bg-[#F4F6F4] text-[#4B5B50] rounded cursor-pointer"
                                    >
                                      Hủy
                                    </button>
                                  </div>
                                ) : (
                                  <button
                                    type="button"
                                    onClick={() => setConfirmDeleteCandidateKey(person.key)}
                                    title="Xóa toàn bộ lượt thi của thí sinh này"
                                    className="p-1.5 rounded-md text-[#B91C1C] hover:bg-[#FEF2F2] cursor-pointer"
                                  >
                                    <Trash2 className="w-4 h-4" />
                                  </button>
                                )}
                              </div>
                            </td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                </>
              )}
            </div>
          </div>
        </div>
      )}

      {/* ==================== TAB 2: QUẢN LÝ BỘ ĐỀ & ĐẨY ĐỀ TỪ FILE ==================== */}
      {subTab === 'topics' && (
        <div className="space-y-6">
          {/* Thanh Quản Lý Bộ Đề + Đẩy Đề Từ File Máy Tính */}
          <div className="bg-white border border-[#DDE3DC] rounded-xl p-5 space-y-4">
            <div className="flex flex-col xl:flex-row xl:items-center justify-between gap-4">
              <div className="flex flex-wrap items-center gap-3 flex-1">
                <label
                  htmlFor="admin-topic-select"
                  className="text-xs font-bold uppercase tracking-wider text-[#4B5B50] whitespace-nowrap"
                >
                  Bộ đề đang chọn:
                </label>
                <select
                  id="admin-topic-select"
                  value={selectedTopic?.id || ''}
                  onChange={(e) => {
                    setSelectedTopicId(e.target.value);
                    resetSingleQuestionForm();
                  }}
                  className="flex-1 min-w-[220px] max-w-md px-3.5 py-2 bg-[#FAFBF9] border border-[#CFD8CE] rounded-lg text-sm font-semibold text-[#152019] focus:outline-none focus:border-[#1F4D36] cursor-pointer"
                >
                  {topics.length === 0 && <option value="">Chưa có chuyên đề</option>}
                  {topics.map((t) => (
                    <option key={t.id} value={t.id}>
                      [{t.code}] {t.title} ({t.questions.length} câu)
                    </option>
                  ))}
                </select>

                <button
                  type="button"
                  onClick={openCreateTopic}
                  className="inline-flex items-center gap-1.5 px-3.5 py-2 text-xs font-semibold text-[#1F4D36] bg-[#EEF5F0] hover:bg-[#DCECE1] border border-[#BFD8C7] rounded-lg whitespace-nowrap cursor-pointer"
                >
                  <Plus className="w-4 h-4" />
                  <span>Tạo bộ đề mới</span>
                </button>

                {selectedTopic && (
                  <>
                    <button
                      type="button"
                      onClick={openEditTopic}
                      className="inline-flex items-center gap-1.5 px-3 py-2 text-xs font-semibold text-[#243329] bg-[#F4F6F4] hover:bg-[#E7ECE7] border border-[#DDE3DC] rounded-lg whitespace-nowrap cursor-pointer"
                    >
                      <Edit3 className="w-3.5 h-3.5" />
                      <span>Sửa bộ đề</span>
                    </button>

                    {confirmDeleteTopic ? (
                      <div className="inline-flex items-center gap-1.5">
                        <button
                          type="button"
                          onClick={handleDeleteCurrentTopic}
                          className="px-3 py-2 text-xs font-bold bg-[#B91C1C] text-white rounded-lg cursor-pointer"
                        >
                          Xác nhận xóa
                        </button>
                        <button
                          type="button"
                          onClick={() => setConfirmDeleteTopic(false)}
                          className="px-2.5 py-2 text-xs font-semibold bg-[#F4F6F4] text-[#4B5B50] rounded-lg cursor-pointer"
                        >
                          Hủy
                        </button>
                      </div>
                    ) : (
                      <button
                        type="button"
                        onClick={() => setConfirmDeleteTopic(true)}
                        className="inline-flex items-center gap-1.5 px-3 py-2 text-xs font-semibold text-[#B91C1C] bg-[#FEF2F2] hover:bg-[#FEE2E2] border border-[#FECACA] rounded-lg whitespace-nowrap cursor-pointer"
                      >
                        <Trash2 className="w-3.5 h-3.5" />
                        <span>Xóa</span>
                      </button>
                    )}
                  </>
                )}
              </div>

              {/* Direct File Upload Button on Topic Management Bar */}
              <div className="flex flex-wrap items-center gap-2.5 shrink-0 pt-2 xl:pt-0 border-t xl:border-t-0 border-[#EDF1EC]">
                <input
                  ref={quizFileInputRef}
                  type="file"
                  accept=".docx,.txt,.csv,.json"
                  onChange={handleQuizFileSelected}
                  className="hidden"
                />
                <button
                  type="button"
                  disabled={isParsingFile}
                  onClick={() => quizFileInputRef.current?.click()}
                  className="inline-flex items-center gap-2 px-4 py-2.5 bg-[#8C6516] hover:bg-[#745210] text-white text-xs sm:text-sm font-semibold rounded-lg transition-colors whitespace-nowrap cursor-pointer"
                >
                  <FileUp className="w-4 h-4" />
                  <span>
                    {isParsingFile
                      ? 'Đang đọc tệp...'
                      : 'Đẩy đề từ máy tính (.docx, .txt, .csv, .json)'}
                  </span>
                </button>
                {selectedTopic && selectedTopic.questions.length > 0 && (
                  <button
                    type="button"
                    onClick={handleExportCurrentTopicText}
                    className="inline-flex items-center gap-1.5 px-3.5 py-2.5 bg-[#FAFBF9] hover:bg-[#EEF5F0] border border-[#CFD8CE] text-[#152019] text-xs font-semibold rounded-lg whitespace-nowrap cursor-pointer"
                  >
                    <Download className="w-3.5 h-3.5 text-[#1F4D36]" />
                    <span>Xuất bộ đề (.txt)</span>
                  </button>
                )}
              </div>
            </div>

            {/* Preview parsed file panel */}
            {parsedPreview && (
              <div className="mt-4 p-5 rounded-xl bg-[#FAFBF9] border border-[#BFD8C7] space-y-4">
                <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3">
                  <div>
                    <h4 className="text-sm font-bold text-[#152019]">
                      Xem trước tệp đã đọc: {parsedPreview.fileName} (
                      {parsedPreview.result.questions.length} câu hỏi)
                    </h4>
                    {parsedPreview.result.warnings.length > 0 && (
                      <ul className="text-xs text-[#9A5B06] mt-1 list-disc list-inside space-y-0.5">
                        {parsedPreview.result.warnings.map((w, i) => (
                          <li key={i}>{w}</li>
                        ))}
                      </ul>
                    )}
                  </div>
                  <button
                    type="button"
                    onClick={() => setParsedPreview(null)}
                    className="text-xs font-semibold text-[#64756A] hover:text-[#152019] self-start cursor-pointer"
                  >
                    Đóng xem trước
                  </button>
                </div>

                <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                  <div>
                    <label className="block text-xs font-semibold text-[#243329] mb-1">
                      Cách thức nạp vào hệ thống
                    </label>
                    <select
                      value={parsedPreview.targetMode}
                      onChange={(e) =>
                        setParsedPreview({
                          ...parsedPreview,
                          targetMode: e.target.value as 'append' | 'replace' | 'new_topic',
                        })
                      }
                      className="w-full px-3 py-2 bg-white border border-[#CFD8CE] rounded-lg text-sm"
                    >
                      {selectedTopic && (
                        <>
                          <option value="append">
                            Thêm nối tiếp vào chuyên đề "{selectedTopic.title}"
                          </option>
                          <option value="replace">
                            Thay thế toàn bộ câu hỏi trong "{selectedTopic.title}"
                          </option>
                        </>
                      )}
                      <option value="new_topic">Tạo thành chuyên đề mới</option>
                    </select>
                  </div>

                  {parsedPreview.targetMode === 'new_topic' && (
                    <div>
                      <label className="block text-xs font-semibold text-[#243329] mb-1">
                        Tên chuyên đề mới
                      </label>
                      <input
                        type="text"
                        value={parsedPreview.newTopicTitle}
                        onChange={(e) =>
                          setParsedPreview({ ...parsedPreview, newTopicTitle: e.target.value })
                        }
                        className="w-full px-3 py-2 bg-white border border-[#CFD8CE] rounded-lg text-sm"
                      />
                    </div>
                  )}
                </div>

                <div className="max-h-56 overflow-y-auto space-y-2 pr-1">
                  {parsedPreview.result.questions.map((q, i) => (
                    <div
                      key={q.id}
                      className="p-3 bg-white border border-[#DDE3DC] rounded-lg text-xs space-y-1"
                    >
                      <div className="font-bold text-[#152019]">
                        Câu {i + 1}: {q.text}
                      </div>
                      <div className="text-[#4B5B50]">
                        {q.options.map((o, oIdx) => (
                          <span
                            key={oIdx}
                            className={`mr-3 ${
                              oIdx === q.correctIndex ? 'font-bold text-[#166534]' : ''
                            }`}
                          >
                            {OPTION_LETTERS[oIdx]}. {o}
                          </span>
                        ))}
                      </div>
                    </div>
                  ))}
                </div>

                <div className="flex justify-end gap-2">
                  <button
                    type="button"
                    onClick={() => setParsedPreview(null)}
                    className="px-4 py-2 text-xs font-semibold bg-white border border-[#DDE3DC] rounded-lg cursor-pointer"
                  >
                    Hủy
                  </button>
                  <button
                    type="button"
                    onClick={handleConfirmImportParsed}
                    className="px-5 py-2 text-xs font-semibold bg-[#1F4D36] hover:bg-[#173B29] text-white rounded-lg cursor-pointer"
                  >
                    Xác nhận nạp {parsedPreview.result.questions.length} câu hỏi
                  </button>
                </div>
              </div>
            )}
          </div>

          {/* FORM TỔNG HỢP TOÀN BỘ CÂU HỎI & VÍ DỤ */}
          <div className="grid grid-cols-1 lg:grid-cols-12 gap-6 items-start">
            {/* Left 7 cols: Form Tổng Hợp Toàn Bộ Câu Hỏi */}
            <div className="lg:col-span-7 space-y-6">
              {/* Bulk Form */}
              <div className="bg-white border border-[#DDE3DC] rounded-xl p-6 space-y-4">
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <div>
                    <h3 className="text-base font-bold text-[#152019]">
                      Form Tổng Hợp Toàn Bộ Câu Hỏi
                    </h3>
                    <p className="text-xs text-[#64756A]">
                      Soạn hoặc dán nhiều câu hỏi cùng lúc để nạp nhanh vào bộ đề đang chọn.
                    </p>
                  </div>
                  <button
                    type="button"
                    onClick={handleLoadAllQuestionsToBulkForm}
                    className="inline-flex items-center gap-1.5 px-3 py-1.5 text-xs font-semibold text-[#1F4D36] bg-[#EEF5F0] hover:bg-[#DCECE1] rounded-lg cursor-pointer"
                  >
                    <RefreshCw className="w-3.5 h-3.5" />
                    <span>
                      {selectedTopic && selectedTopic.questions.length > 0
                        ? 'Tải toàn bộ câu hiện có vào Form'
                        : 'Chèn dữ liệu mẫu'}
                    </span>
                  </button>
                </div>

                <textarea
                  rows={9}
                  value={bulkFormText}
                  onChange={(e) => setBulkFormText(e.target.value)}
                  placeholder={`Câu 1: Nội dung câu hỏi...\nA. Đáp án A\nB. Đáp án B\nC. Đáp án C\nD. Đáp án D\nĐáp án: B\nGiải thích: Nội dung giải thích...`}
                  className="w-full p-3.5 bg-[#FAFBF9] border border-[#CFD8CE] rounded-lg text-xs sm:text-sm font-mono text-[#152019] focus:outline-none focus:ring-2 focus:ring-[#1F4D36]/25 focus:border-[#1F4D36]"
                />

                <div className="flex flex-wrap items-center justify-between gap-3">
                  <button
                    type="button"
                    onClick={() => setBulkFormText('')}
                    className="px-3.5 py-2 text-xs font-semibold text-[#4B5B50] bg-[#F4F6F4] hover:bg-[#E7ECE7] rounded-lg cursor-pointer"
                  >
                    Xóa trắng khung soạn
                  </button>
                  <button
                    type="button"
                    onClick={handleBulkParseAndAdd}
                    className="px-5 py-2 text-xs sm:text-sm font-semibold text-white bg-[#1F4D36] hover:bg-[#173B29] rounded-lg transition-colors cursor-pointer"
                  >
                    Phân tích & Thêm vào bộ đề
                  </button>
                </div>
              </div>

              {/* Single question add/edit */}
              <div className="bg-white border border-[#DDE3DC] rounded-xl p-6 space-y-4">
                <h3 className="text-base font-bold text-[#152019]">
                  {singleQId ? 'Chỉnh sửa câu hỏi đơn lẻ' : 'Thêm từng câu hỏi trực tiếp'}
                </h3>
                <form onSubmit={handleSaveSingleQuestion} className="space-y-4">
                  <div>
                    <label className="block text-xs font-semibold text-[#243329] mb-1">
                      Nội dung câu hỏi
                    </label>
                    <textarea
                      rows={2}
                      value={singleQText}
                      onChange={(e) => setSingleQText(e.target.value)}
                      placeholder="Nhập nội dung câu hỏi trắc nghiệm..."
                      className="w-full p-3 bg-[#FAFBF9] border border-[#CFD8CE] rounded-lg text-sm text-[#152019] focus:outline-none focus:border-[#1F4D36]"
                    />
                  </div>

                  <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                    {OPTION_LETTERS.map((letter, idx) => (
                      <div key={letter}>
                        <div className="flex items-center justify-between mb-1">
                          <label className="text-xs font-semibold text-[#243329]">
                            Đáp án {letter}
                          </label>
                          <label className="inline-flex items-center gap-1 text-xs font-semibold text-[#1F4D36] cursor-pointer">
                            <input
                              type="radio"
                              name="single-q-correct"
                              checked={singleQCorrect === idx}
                              onChange={() => setSingleQCorrect(idx)}
                            />
                            <span>Đáp án đúng</span>
                          </label>
                        </div>
                        <input
                          type="text"
                          value={singleQOpts[idx]}
                          onChange={(e) => {
                            const next = [...singleQOpts] as [string, string, string, string];
                            next[idx] = e.target.value;
                            setSingleQOpts(next);
                          }}
                          placeholder={`Nhập phương án ${letter}`}
                          className="w-full px-3 py-2 bg-[#FAFBF9] border border-[#CFD8CE] rounded-lg text-sm"
                        />
                      </div>
                    ))}
                  </div>

                  <div>
                    <label className="block text-xs font-semibold text-[#243329] mb-1">
                      Giải thích đáp án (chỉ hiển thị sau khi nộp bài)
                    </label>
                    <input
                      type="text"
                      value={singleQExplain}
                      onChange={(e) => setSingleQExplain(e.target.value)}
                      placeholder="Nhập lời giải thích ngắn gọn..."
                      className="w-full px-3 py-2 bg-[#FAFBF9] border border-[#CFD8CE] rounded-lg text-sm"
                    />
                  </div>

                  <div className="flex items-center justify-end gap-2">
                    {singleQId && (
                      <button
                        type="button"
                        onClick={resetSingleQuestionForm}
                        className="px-4 py-2 text-xs font-semibold bg-[#F4F6F4] text-[#4B5B50] rounded-lg cursor-pointer"
                      >
                        Hủy sửa
                      </button>
                    )}
                    <button
                      type="submit"
                      className="px-5 py-2 text-xs sm:text-sm font-semibold text-white bg-[#1F4D36] hover:bg-[#173B29] rounded-lg cursor-pointer"
                    >
                      {singleQId ? 'Cập nhật câu hỏi' : 'Thêm câu hỏi'}
                    </button>
                  </div>
                </form>
              </div>
            </div>

            {/* Right 5 cols: Ví dụ chuẩn 4 định dạng */}
            <div className="lg:col-span-5 bg-white border border-[#DDE3DC] rounded-xl p-6 space-y-4">
              <div>
                <h3 className="text-base font-bold text-[#152019]">
                  Ví Dụ Chuẩn Định Dạng Đề Thi
                </h3>
                <p className="text-xs text-[#64756A] mt-0.5">
                  Hỗ trợ đẩy file .docx, .txt, .csv, .json hoặc sao chép vào Form Tổng Hợp.
                </p>
              </div>

              <div className="grid grid-cols-4 gap-1.5 p-1 bg-[#E7ECE7] rounded-lg">
                {(
                  [
                    { id: 'txt', label: '.TXT' },
                    { id: 'docx', label: '.DOCX' },
                    { id: 'csv', label: '.CSV' },
                    { id: 'json', label: '.JSON' },
                  ] as const
                ).map((fmt) => (
                  <button
                    key={fmt.id}
                    type="button"
                    onClick={() => setExampleFormat(fmt.id)}
                    className={`py-1.5 text-xs font-bold rounded-md transition-colors cursor-pointer ${
                      exampleFormat === fmt.id
                        ? 'bg-white text-[#1F4D36] shadow-sm'
                        : 'text-[#4B5B50]'
                    }`}
                  >
                    {fmt.label}
                  </button>
                ))}
              </div>

              {(exampleFormat === 'txt' || exampleFormat === 'docx') && (
                <div className="space-y-3">
                  <p className="text-xs text-[#4B5B50]">
                    {exampleFormat === 'docx'
                      ? 'File Word (.docx) soạn thảo tự nhiên theo cấu trúc câu hỏi bên dưới (hoặc đánh dấu * trước đáp án đúng như *B. ...):'
                      : 'File văn bản thuần UTF-8 (.txt) theo cấu trúc chuẩn:'}
                  </p>
                  <pre className="p-3.5 rounded-lg bg-[#FAFBF9] border border-[#DDE3DC] text-xs font-mono text-[#152019] overflow-x-auto whitespace-pre-wrap leading-relaxed">
                    {SAMPLE_TXT_TEMPLATE}
                  </pre>
                  <div className="flex flex-wrap gap-2">
                    <button
                      type="button"
                      onClick={() => setBulkFormText(SAMPLE_TXT_TEMPLATE)}
                      className="inline-flex items-center gap-1.5 px-3 py-1.5 text-xs font-semibold text-[#1F4D36] bg-[#EEF5F0] hover:bg-[#DCECE1] rounded-lg cursor-pointer"
                    >
                      <FileText className="w-3.5 h-3.5" />
                      <span>Chèn ví dụ vào Form</span>
                    </button>
                    <button
                      type="button"
                      onClick={() =>
                        downloadTextFile(
                          'mau_de_thi.txt',
                          SAMPLE_TXT_TEMPLATE,
                          'text/plain;charset=utf-8'
                        )
                      }
                      className="inline-flex items-center gap-1.5 px-3 py-1.5 text-xs font-semibold text-[#243329] bg-[#F4F6F4] hover:bg-[#E7ECE7] rounded-lg cursor-pointer"
                    >
                      <Download className="w-3.5 h-3.5" />
                      <span>Tải file mẫu .txt</span>
                    </button>
                  </div>
                </div>
              )}

              {exampleFormat === 'csv' && (
                <div className="space-y-3">
                  <p className="text-xs text-[#4B5B50]">
                    Bảng tính Excel lưu dưới dạng CSV UTF-8 gồm 7 cột: Câu hỏi, A, B, C, D, Đáp án đúng (A/B/C/D), Giải thích:
                  </p>
                  <pre className="p-3.5 rounded-lg bg-[#FAFBF9] border border-[#DDE3DC] text-xs font-mono text-[#152019] overflow-x-auto whitespace-pre-wrap leading-relaxed">
                    {SAMPLE_CSV_TEMPLATE}
                  </pre>
                  <button
                    type="button"
                    onClick={() =>
                      downloadTextFile(
                        'mau_de_thi.csv',
                        '\uFEFF' + SAMPLE_CSV_TEMPLATE,
                        'text/csv;charset=utf-8'
                      )
                    }
                    className="inline-flex items-center gap-1.5 px-3 py-1.5 text-xs font-semibold text-[#243329] bg-[#F4F6F4] hover:bg-[#E7ECE7] rounded-lg cursor-pointer"
                  >
                    <FileSpreadsheet className="w-3.5 h-3.5 text-[#1F4D36]" />
                    <span>Tải file mẫu .csv</span>
                  </button>
                </div>
              )}

              {exampleFormat === 'json' && (
                <div className="space-y-3">
                  <p className="text-xs text-[#4B5B50]">
                    Tệp JSON chuẩn chứa tiêu đề, thời gian và mảng câu hỏi:
                  </p>
                  <pre className="p-3.5 rounded-lg bg-[#FAFBF9] border border-[#DDE3DC] text-xs font-mono text-[#152019] overflow-x-auto whitespace-pre-wrap leading-relaxed max-h-72">
                    {SAMPLE_JSON_TEMPLATE}
                  </pre>
                  <button
                    type="button"
                    onClick={() => downloadTextFile('mau_de_thi.json', SAMPLE_JSON_TEMPLATE)}
                    className="inline-flex items-center gap-1.5 px-3 py-1.5 text-xs font-semibold text-[#243329] bg-[#F4F6F4] hover:bg-[#E7ECE7] rounded-lg cursor-pointer"
                  >
                    <Download className="w-3.5 h-3.5 text-[#1F4D36]" />
                    <span>Tải file mẫu .json</span>
                  </button>
                </div>
              )}
            </div>
          </div>

          {/* Current Questions List in Selected Topic */}
          {selectedTopic && (
            <div className="bg-white border border-[#DDE3DC] rounded-xl overflow-hidden">
              <div className="px-6 py-4 border-b border-[#DDE3DC] bg-[#FAFBF9] flex items-center justify-between">
                <h3 className="text-base font-bold text-[#152019]">
                  Toàn bộ câu hỏi trong "{selectedTopic.title}" ({selectedTopic.questions.length}{' '}
                  câu)
                </h3>
              </div>

              {selectedTopic.questions.length === 0 ? (
                <div className="p-8 text-center text-sm text-[#64756A]">
                  Chuyên đề này chưa có câu hỏi nào. Hãy đẩy file từ máy tính hoặc thêm ở Form Tổng Hợp phía trên.
                </div>
              ) : (
                <div className="divide-y divide-[#EDF1EC]">
                  {selectedTopic.questions.map((q, idx) => (
                    <div
                      key={q.id}
                      className="p-5 flex flex-col sm:flex-row sm:items-start justify-between gap-4 hover:bg-[#FAFBF9]"
                    >
                      <div className="space-y-2 flex-1">
                        <div className="text-sm font-bold text-[#152019]">
                          <span className="font-mono-num text-[#1F4D36] mr-2">
                            Câu {idx + 1}:
                          </span>
                          {q.text}
                        </div>
                        <div className="grid grid-cols-1 sm:grid-cols-2 gap-1.5 text-xs">
                          {q.options.map((opt, oIdx) => (
                            <div
                              key={oIdx}
                              className={`px-2.5 py-1.5 rounded border ${
                                oIdx === q.correctIndex
                                  ? 'bg-[#ECFDF5] border-[#BBF7D0] text-[#166534] font-semibold'
                                  : 'bg-[#FAFBF9] border-[#E4EAE3] text-[#4B5B50]'
                              }`}
                            >
                              {OPTION_LETTERS[oIdx]}. {opt}
                            </div>
                          ))}
                        </div>
                        {q.explanation && (
                          <p className="text-xs text-[#4B5B50]">
                            <strong className="text-[#1F4D36]">Giải thích:</strong> {q.explanation}
                          </p>
                        )}
                      </div>

                      <div className="flex items-center gap-1.5 shrink-0">
                        <button
                          type="button"
                          onClick={() => handleEditQuestion(q)}
                          className="p-2 rounded-lg text-[#1F4D36] hover:bg-[#EEF5F0] cursor-pointer"
                          title="Chỉnh sửa câu hỏi"
                        >
                          <Edit3 className="w-4 h-4" />
                        </button>
                        <button
                          type="button"
                          onClick={() => handleDeleteQuestion(q.id)}
                          className="p-2 rounded-lg text-[#B91C1C] hover:bg-[#FEF2F2] cursor-pointer"
                          title="Xóa câu hỏi"
                        >
                          <Trash2 className="w-4 h-4" />
                        </button>
                      </div>
                    </div>
                  ))}
                </div>
              )}
            </div>
          )}
        </div>
      )}

      {/* ==================== TAB 3: LƯU TRỮ DỮ LIỆU ĐÁM MÂY & SAO LƯU ==================== */}
      {subTab === 'storage' && (
        <div className="grid grid-cols-1 lg:grid-cols-12 gap-6 items-start">
          {/* Cloud Firestore Storage Panel */}
          <div className="lg:col-span-7 bg-white border border-[#DDE3DC] rounded-xl overflow-hidden">
            <div className="px-6 py-4 border-b border-[#DDE3DC] bg-[#FAFBF9] flex items-center justify-between gap-3">
              <div className="flex items-center gap-2.5">
                <div className="w-9 h-9 rounded-lg bg-[#1F4D36] text-[#F5E1A4] flex items-center justify-center shrink-0">
                  <Database className="w-4 h-4" />
                </div>
                <div>
                  <h3 className="text-base font-bold text-[#152019]">
                    Lưu trữ cơ sở dữ liệu đám mây (Firebase Firestore)
                  </h3>
                  <p className="text-xs text-[#64756A]">
                    Đồng bộ tự động tài khoản, bộ câu hỏi chuyên đề và lịch sử lượt thi giữa mọi thiết bị.
                  </p>
                </div>
              </div>
            </div>

            <div className="p-6 space-y-5">
              {cloud.error && (
                <div
                  role="alert"
                  className="flex items-start gap-2.5 p-3.5 rounded-lg bg-[#FEF2F2] border border-[#FECACA] text-[#B91C1C] text-xs leading-relaxed"
                >
                  <AlertCircle className="w-4 h-4 shrink-0 mt-0.5" />
                  <span>{cloud.error}</span>
                </div>
              )}

              {!cloud.connected ? (
                <div className="space-y-4">
                  <div className="p-4 rounded-xl bg-[#FAFBF9] border border-[#DDE3DC] space-y-2">
                    <div className="flex items-center gap-2 text-sm font-bold text-[#152019]">
                      <CloudOff className="w-4 h-4 text-[#64756A]" />
                      <span>Chưa kết nối tài khoản lưu trữ đám mây</span>
                    </div>
                    <p className="text-xs text-[#4B5B50] leading-relaxed">
                      Hiện hệ thống đang lưu trữ trên bộ nhớ trình duyệt cục bộ (localStorage). Hãy
                      đăng nhập Google để kích hoạt đồng bộ thời gian thực với cơ sở dữ liệu Firebase
                      Firestore, đảm bảo dữ liệu không bị mất khi đổi máy hoặc xóa bộ nhớ trình duyệt.
                    </p>
                  </div>

                  <button
                    type="button"
                    disabled={cloud.syncing}
                    onClick={() => void onConnectCloud()}
                    className="w-full sm:w-auto px-5 py-2.5 bg-[#1F4D36] hover:bg-[#173B29] disabled:opacity-60 text-white text-sm font-semibold rounded-lg inline-flex items-center justify-center gap-2 transition-colors cursor-pointer"
                  >
                    <Cloud className="w-4 h-4" />
                    <span>
                      {cloud.syncing
                        ? 'Đang kết nối...'
                        : 'Kết nối lưu trữ đám mây (Đăng nhập Google)'}
                    </span>
                  </button>
                </div>
              ) : (
                <div className="space-y-5">
                  <div className="p-4 rounded-xl bg-[#ECFDF5] border border-[#BBF7D0] space-y-1.5">
                    <div className="flex flex-wrap items-center justify-between gap-2">
                      <span className="text-sm font-bold text-[#166534] inline-flex items-center gap-2">
                        <Cloud className="w-4 h-4" />
                        Đã kích hoạt lưu trữ đám mây Firebase Firestore
                      </span>
                      {cloud.isCloudAdmin && (
                        <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded bg-white border border-[#BBF7D0] text-[11px] font-bold text-[#166534]">
                          <ShieldCheck className="w-3.5 h-3.5" />
                          Quản trị viên đám mây
                        </span>
                      )}
                    </div>
                    <p className="text-xs text-[#166534]/90">
                      Tài khoản Google đang liên kết: <strong>{cloud.userEmail}</strong>
                    </p>
                    {cloud.lastSyncedAt && (
                      <p className="text-xs text-[#166534]/80 font-mono-num">
                        Lần đồng bộ gần nhất: {formatDateTime(cloud.lastSyncedAt)}
                      </p>
                    )}
                  </div>

                  <div className="grid grid-cols-3 gap-3">
                    <div className="p-4 rounded-xl bg-[#FAFBF9] border border-[#DDE3DC] text-center">
                      <div className="font-mono-num text-xl font-bold text-[#1F4D36]">
                        {cloud.isCloudAdmin ? cloud.cloudAccountCount : accounts.length}
                      </div>
                      <div className="text-xs text-[#64756A] mt-1">Tài khoản</div>
                    </div>
                    <div className="p-4 rounded-xl bg-[#FAFBF9] border border-[#DDE3DC] text-center">
                      <div className="font-mono-num text-xl font-bold text-[#1F4D36]">
                        {cloud.cloudTopicCount}
                      </div>
                      <div className="text-xs text-[#64756A] mt-1">Chuyên đề</div>
                    </div>
                    <div className="p-4 rounded-xl bg-[#FAFBF9] border border-[#DDE3DC] text-center">
                      <div className="font-mono-num text-xl font-bold text-[#1F4D36]">
                        {cloud.cloudAttemptCount}
                      </div>
                      <div className="text-xs text-[#64756A] mt-1">Lượt thi</div>
                    </div>
                  </div>

                  <div className="flex flex-wrap items-center gap-3 pt-1">
                    <button
                      type="button"
                      disabled={cloud.syncing}
                      onClick={async () => {
                        await onSyncCloudNow();
                        showToast(
                          'success',
                          'Đã đồng bộ toàn bộ dữ liệu hiện tại lên cơ sở dữ liệu đám mây.'
                        );
                      }}
                      className="px-4 py-2.5 bg-[#1F4D36] hover:bg-[#173B29] disabled:opacity-60 text-white text-xs sm:text-sm font-semibold rounded-lg inline-flex items-center gap-2 transition-colors cursor-pointer"
                    >
                      <RefreshCw
                        className={`w-4 h-4 ${cloud.syncing ? 'animate-spin' : ''}`}
                      />
                      <span>
                        {cloud.syncing ? 'Đang đồng bộ...' : 'Đồng bộ ngay lên đám mây'}
                      </span>
                    </button>

                    <button
                      type="button"
                      disabled={cloud.syncing}
                      onClick={async () => {
                        await onDisconnectCloud();
                        showToast(
                          'success',
                          'Đã ngắt kết nối đám mây. Dữ liệu cục bộ vẫn được giữ nguyên.'
                        );
                      }}
                      className="px-4 py-2.5 bg-[#FEF2F2] hover:bg-[#FEE2E2] text-[#B91C1C] border border-[#FECACA] text-xs sm:text-sm font-semibold rounded-lg inline-flex items-center gap-2 transition-colors cursor-pointer"
                    >
                      <LogOut className="w-4 h-4" />
                      <span>Ngắt kết nối Google</span>
                    </button>
                  </div>
                </div>
              )}
            </div>
          </div>

          {/* Local JSON File Backup & Restore Card */}
          <div className="lg:col-span-5 bg-white border border-[#DDE3DC] rounded-xl p-6 space-y-4">
            <div>
              <h3 className="text-base font-bold text-[#152019]">
                Sao lưu & Nạp tệp dữ liệu ngoại tuyến (.json)
              </h3>
              <p className="text-xs text-[#4B5B50] mt-1 leading-relaxed">
                Xuất bản sao dự phòng toàn bộ hệ thống về máy tính hoặc nạp lại dữ liệu từ tệp JSON
                đã lưu trước đó. Khi đang kết nối đám mây, dữ liệu nạp sẽ tự động đồng bộ lên
                Firebase Firestore.
              </p>
            </div>

            <div className="grid grid-cols-3 gap-2.5 text-center">
              <div className="p-3 rounded-lg bg-[#F4F6F4] border border-[#DDE3DC]">
                <div className="font-mono-num text-base font-bold text-[#152019]">
                  {accounts.length}
                </div>
                <div className="text-[11px] text-[#64756A]">Tài khoản</div>
              </div>
              <div className="p-3 rounded-lg bg-[#F4F6F4] border border-[#DDE3DC]">
                <div className="font-mono-num text-base font-bold text-[#152019]">
                  {topics.length}
                </div>
                <div className="text-[11px] text-[#64756A]">Chuyên đề</div>
              </div>
              <div className="p-3 rounded-lg bg-[#F4F6F4] border border-[#DDE3DC]">
                <div className="font-mono-num text-base font-bold text-[#152019]">
                  {attempts.length}
                </div>
                <div className="text-[11px] text-[#64756A]">Lượt thi</div>
              </div>
            </div>

            <div className="space-y-2.5 pt-1">
              <button
                type="button"
                onClick={handleExportFull}
                className="w-full py-2.5 px-4 bg-[#FAFBF9] hover:bg-[#EEF5F0] border border-[#CFD8CE] rounded-lg text-xs font-semibold text-[#152019] flex items-center justify-center gap-2 transition-colors cursor-pointer"
              >
                <Download className="w-4 h-4 text-[#8C6516]" />
                <span>Tải bản sao lưu Toàn bộ Hệ thống (.json)</span>
              </button>

              <button
                type="button"
                onClick={handleExportAccounts}
                className="w-full py-2.5 px-4 bg-[#FAFBF9] hover:bg-[#EEF5F0] border border-[#CFD8CE] rounded-lg text-xs font-semibold text-[#152019] flex items-center justify-center gap-2 transition-colors cursor-pointer"
              >
                <Download className="w-4 h-4 text-[#1F4D36]" />
                <span>Tải bản sao lưu Tài khoản (.json)</span>
              </button>

              <button
                type="button"
                onClick={() => backupInputRef.current?.click()}
                className="w-full py-2.5 px-4 bg-[#1F4D36] hover:bg-[#173B29] rounded-lg text-xs font-semibold text-white flex items-center justify-center gap-2 transition-colors cursor-pointer"
              >
                <Upload className="w-4 h-4" />
                <span>Nạp dữ liệu từ tệp (.json)</span>
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Create / Edit Topic Modal */}
      <AnimatePresence>
        {showTopicModal && (
          <motion.div
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            transition={{ duration: 0.18 }}
            onClick={() => setShowTopicModal(null)}
            className="fixed inset-0 z-50 bg-black/50 backdrop-blur-[2px] flex items-center justify-center p-4"
            role="dialog"
            aria-modal="true"
          >
            <motion.div
              initial={{ opacity: 0, scale: 0.96, y: 10 }}
              animate={{ opacity: 1, scale: 1, y: 0 }}
              exit={{ opacity: 0, scale: 0.96, y: 8 }}
              transition={{ duration: 0.2, ease: EASE_SMOOTH }}
              onClick={(e) => e.stopPropagation()}
              className="bg-white border border-[#DDE3DC] rounded-xl max-w-lg w-full p-6 shadow-xl"
            >
              <div className="flex items-center justify-between pb-3 border-b border-[#EDF1EC] mb-4">
                <h3 className="text-lg font-bold text-[#152019]">
                  {showTopicModal === 'create' ? 'Tạo chuyên đề mới' : 'Chỉnh sửa chuyên đề'}
                </h3>
              <button
                type="button"
                onClick={() => setShowTopicModal(null)}
                className="p-1.5 rounded-lg text-[#4B5B50] hover:bg-[#F4F6F4] cursor-pointer"
              >
                <X className="w-4 h-4" />
              </button>
            </div>

            <form onSubmit={handleSaveTopicModal} className="space-y-4">
              <div className="grid grid-cols-3 gap-3">
                <div>
                  <label className="block text-xs font-semibold text-[#243329] mb-1">
                    Mã chuyên đề
                  </label>
                  <input
                    type="text"
                    value={topicCode}
                    onChange={(e) => setTopicCode(e.target.value)}
                    placeholder="CD-04"
                    className="w-full px-3 py-2 bg-[#FAFBF9] border border-[#CFD8CE] rounded-lg text-sm"
                  />
                </div>
                <div className="col-span-2">
                  <label className="block text-xs font-semibold text-[#243329] mb-1">
                    Thời gian làm bài (phút)
                  </label>
                  <input
                    type="number"
                    min={1}
                    max={180}
                    value={topicMinutes}
                    onChange={(e) => setTopicMinutes(Number(e.target.value))}
                    className="w-full px-3 py-2 bg-[#FAFBF9] border border-[#CFD8CE] rounded-lg text-sm"
                  />
                </div>
              </div>

              <div>
                <label className="block text-xs font-semibold text-[#243329] mb-1">
                  Tên chuyên đề <span className="text-[#B91C1C]">*</span>
                </label>
                <input
                  type="text"
                  required
                  value={topicTitle}
                  onChange={(e) => setTopicTitle(e.target.value)}
                  placeholder="Nhập tên chuyên đề..."
                  className="w-full px-3 py-2 bg-[#FAFBF9] border border-[#CFD8CE] rounded-lg text-sm"
                />
              </div>

              <div>
                <label className="block text-xs font-semibold text-[#243329] mb-1">
                  Mô tả ngắn
                </label>
                <textarea
                  rows={3}
                  value={topicDescription}
                  onChange={(e) => setTopicDescription(e.target.value)}
                  placeholder="Mô tả nội dung chuyên đề..."
                  className="w-full px-3 py-2 bg-[#FAFBF9] border border-[#CFD8CE] rounded-lg text-sm"
                />
              </div>

              <div className="pt-2 flex justify-end gap-2">
                <button
                  type="button"
                  onClick={() => setShowTopicModal(null)}
                  className="px-4 py-2 text-sm font-semibold bg-[#F4F6F4] text-[#4B5B50] rounded-lg cursor-pointer"
                >
                  Hủy
                </button>
                <button
                  type="submit"
                  className="px-5 py-2 text-sm font-semibold bg-[#1F4D36] hover:bg-[#173B29] text-white rounded-lg cursor-pointer"
                >
                  {showTopicModal === 'create' ? 'Tạo chuyên đề' : 'Lưu thay đổi'}
                </button>
              </div>
            </form>
            </motion.div>
          </motion.div>
        )}
      </AnimatePresence>

      {/* Candidate Detail Modal for Admin grouped attempts */}
      <AnimatePresence>
        {selectedAdminCandidate && (
          <CandidateDetailModal
            title={selectedAdminCandidate.candidateName}
            subtitle={
              [
                selectedAdminCandidate.unitNames.join(' · '),
                selectedAdminCandidate.accountUsernames.length > 0
                  ? `TK: ${selectedAdminCandidate.accountUsernames.join(', ')}`
                  : '',
              ]
                .filter(Boolean)
                .join(' · ') || undefined
            }
            attempts={selectedAdminCandidate.attempts}
            topics={topics}
            showAccountColumn={true}
            onClose={() => setSelectedCandidateKey(null)}
            onDeleteAttempt={(attemptId) => {
              const remainingForCandidate = selectedAdminCandidate.attempts.filter(
                (a) => a.id !== attemptId
              );
              onUpdateAttempts(attempts.filter((a) => a.id !== attemptId));
              if (remainingForCandidate.length === 0) {
                setSelectedCandidateKey(null);
              }
              showToast('success', 'Đã xóa lượt thi đã chọn.');
            }}
          />
        )}
      </AnimatePresence>
    </section>
  );
};
