import { jsPDF } from "jspdf";
import { COMPETITION_NAME } from "@/lib/config";
import { questions } from "@/lib/questions";
import { formatAnswerLetters } from "./answerString";

const C = {
  bg: [255, 255, 255] as const,
  panel: [243, 248, 252] as const,
  panelBorder: [180, 210, 230] as const,
  founders: [0, 59, 112] as const,
  immaculata: [0, 116, 200] as const,
  torero: [0, 116, 200] as const,
  ink: [20, 40, 60] as const,
  muted: [90, 115, 140] as const,
  line: [210, 222, 235] as const,
  white: [255, 255, 255] as const,
  green: [22, 163, 74] as const,
  red: [220, 38, 38] as const,
  unanswered: [100, 116, 139] as const,
};

function formatDuration(secs: number) {
  const m = Math.floor(secs / 60);
  const s = secs % 60;
  if (m === 0) return `${s}s`;
  return `${m}m ${s}s`;
}

async function loadImageDataUrl(src: string): Promise<string | null> {
  try {
    const res = await fetch(src);
    if (!res.ok) return null;
    const blob = await res.blob();
    return await new Promise((resolve, reject) => {
      const reader = new FileReader();
      reader.onload = () => resolve(String(reader.result));
      reader.onerror = () => reject(new Error("Failed to read logo"));
      reader.readAsDataURL(blob);
    });
  } catch {
    return null;
  }
}

export interface ResultPdfInput {
  pid: string;
  name: string;
  email: string;
  score: {
    totalScore: number;
    completionTimeSeconds: number;
    completedAt: string;
  };
  answers: Record<string, { answer: string; isCorrect?: boolean }>;
}

export async function downloadResultPdf(data: ResultPdfInput) {
  const doc = new jsPDF({ unit: "mm", format: "a4" });
  const pageWidth = doc.internal.pageSize.getWidth();
  const pageHeight = doc.internal.pageSize.getHeight();
  const marginX = 16;
  const contentWidth = pageWidth - marginX * 2;
  const footerY = pageHeight - 12;
  const bottomLimit = pageHeight - 22;

  const logoDataUrl = await loadImageDataUrl("/usd-logo-horizontal.png");
  const completedLabel = new Date(data.score.completedAt).toLocaleString();
  const pct = Math.round((data.score.totalScore / questions.length) * 100);
  const timeLabel = formatDuration(data.score.completionTimeSeconds);

  const drawFooter = (pageNum: number, totalPages: number) => {
    doc.setDrawColor(...C.line);
    doc.setLineWidth(0.3);
    doc.line(marginX, footerY - 4, pageWidth - marginX, footerY - 4);
    doc.setFont("helvetica", "normal");
    doc.setFontSize(8);
    doc.setTextColor(...C.muted);
    doc.text(COMPETITION_NAME, marginX, footerY);
    doc.text(`Page ${pageNum} of ${totalPages}`, pageWidth - marginX, footerY, {
      align: "right",
    });
  };

  const ensureSpace = (needed: number, y: number) => {
    if (y + needed <= bottomLimit) return y;
    doc.addPage();
    return 18;
  };

  // Top accent bar
  doc.setFillColor(...C.founders);
  doc.rect(0, 0, pageWidth, 3, "F");
  doc.setFillColor(...C.immaculata);
  doc.rect(0, 3, pageWidth, 1, "F");

  let y = 12;

  if (logoDataUrl) {
    const logoW = 72;
    const logoH = (106 / 512) * logoW;
    doc.addImage(
      logoDataUrl,
      "PNG",
      (pageWidth - logoW) / 2,
      y,
      logoW,
      logoH
    );
    y += logoH + 7;
  }

  doc.setTextColor(...C.founders);
  doc.setFont("helvetica", "bold");
  doc.setFontSize(15);
  doc.text(COMPETITION_NAME, pageWidth / 2, y, { align: "center" });
  y += 5.5;
  doc.setFont("helvetica", "normal");
  doc.setFontSize(9.5);
  doc.setTextColor(...C.immaculata);
  doc.text("Quiz Result", pageWidth / 2, y, { align: "center" });
  y += 5;
  doc.setDrawColor(...C.line);
  doc.setLineWidth(0.4);
  doc.line(marginX + 24, y, pageWidth - marginX - 24, y);
  y += 8;

  // Participant + score panel
  doc.setFillColor(...C.panel);
  doc.setDrawColor(...C.panelBorder);
  doc.setLineWidth(0.35);
  doc.roundedRect(marginX, y, contentWidth, 36, 2.5, 2.5, "FD");

  doc.setTextColor(...C.immaculata);
  doc.setFont("helvetica", "normal");
  doc.setFontSize(7.5);
  doc.text("PARTICIPANT", marginX + 5, y + 7);
  doc.setTextColor(...C.ink);
  doc.setFont("helvetica", "bold");
  doc.setFontSize(12);
  doc.text(data.name, marginX + 5, y + 14);
  doc.setFont("helvetica", "normal");
  doc.setFontSize(9);
  doc.setTextColor(...C.muted);
  doc.text(data.email, marginX + 5, y + 20);

  doc.setFontSize(8);
  doc.setTextColor(...C.muted);
  doc.text(`Time  ${timeLabel}`, marginX + 5, y + 29);
  doc.text(`Completed  ${completedLabel}`, marginX + 52, y + 29);

  const scoreBoxW = 42;
  const scoreBoxX = pageWidth - marginX - scoreBoxW - 4;
  doc.setFillColor(...C.founders);
  doc.roundedRect(scoreBoxX, y + 4, scoreBoxW, 28, 2, 2, "F");
  doc.setTextColor(...C.torero);
  doc.setFont("helvetica", "normal");
  doc.setFontSize(7);
  doc.setTextColor(117, 190, 233);
  doc.text("SCORE", scoreBoxX + scoreBoxW / 2, y + 11, { align: "center" });
  doc.setTextColor(...C.white);
  doc.setFont("helvetica", "bold");
  doc.setFontSize(16);
  doc.text(
    `${data.score.totalScore}/${questions.length}`,
    scoreBoxX + scoreBoxW / 2,
    y + 20,
    { align: "center" }
  );
  doc.setFont("helvetica", "normal");
  doc.setFontSize(8);
  doc.setTextColor(117, 190, 233);
  doc.text(`${pct}% correct`, scoreBoxX + scoreBoxW / 2, y + 27, {
    align: "center",
  });

  y += 46;

  // Responses heading
  doc.setTextColor(...C.founders);
  doc.setFont("helvetica", "bold");
  doc.setFontSize(11);
  doc.text("Your responses", marginX, y);
  doc.setDrawColor(...C.immaculata);
  doc.setLineWidth(0.7);
  doc.line(marginX, y + 2, marginX + 28, y + 2);
  y += 10;

  for (let i = 0; i < questions.length; i++) {
    const q = questions[i];
    const answer = data.answers[q.id];
    const pickedKey = answer?.answer;
    const picked = formatAnswerLetters(pickedKey);

    const correct = answer?.isCorrect;

    let statusLabel = "Not answered";
    let statusColor: [number, number, number] = [...C.unanswered];
    if (pickedKey) {
      if (correct) {
        statusLabel = "Correct";
        statusColor = [...C.green];
      } else {
        statusLabel = "Wrong";
        statusColor = [...C.red];
      }
    }

    const padX = 7;
    const padY = 6;
    const statusReserve = 26;
    const textWidth = contentWidth - padX * 2 - statusReserve;
    const qLineH = 4.6;
    const afterQuestion = 4;
    const answerLineH = 4.2;
    const cardGap = 3.5;

    doc.setFont("helvetica", "bold");
    doc.setFontSize(9);
    const qLines = doc.splitTextToSize(
      `${q.id.toUpperCase()}. ${q.text}`,
      textWidth
    );
    const blockH =
      padY + qLines.length * qLineH + afterQuestion + answerLineH + padY;

    y = ensureSpace(blockH + cardGap, y);

    const cardY = y;
    doc.setFillColor(...C.white);
    doc.setDrawColor(...C.line);
    doc.setLineWidth(0.25);
    doc.roundedRect(marginX, cardY, contentWidth, blockH, 1.5, 1.5, "FD");

    const textY = cardY + padY + 3;

    doc.setFont("helvetica", "bold");
    doc.setFontSize(7.5);
    doc.setTextColor(...statusColor);
    doc.text(statusLabel.toUpperCase(), pageWidth - marginX - padX, textY, {
      align: "right",
    });

    doc.setTextColor(...C.ink);
    doc.setFont("helvetica", "bold");
    doc.setFontSize(9);
    doc.text(qLines, marginX + padX, textY);

    const answerY = textY + (qLines.length - 1) * qLineH + afterQuestion + answerLineH;

    doc.setFont("helvetica", "normal");
    doc.setFontSize(8.5);
    const answerPrefix = "Your answer: ";
    doc.setTextColor(...C.muted);
    doc.text(answerPrefix, marginX + padX, answerY);
    const prefixW = doc.getTextWidth(answerPrefix);
    doc.setFont("helvetica", "bold");
    doc.setTextColor(...statusColor);
    doc.text(`${picked}.`, marginX + padX + prefixW, answerY);

    y = cardY + blockH + cardGap;
  }

  const totalPages = doc.getNumberOfPages();
  for (let p = 1; p <= totalPages; p++) {
    doc.setPage(p);
    drawFooter(p, totalPages);
  }

  doc.save(`result-${data.pid}.pdf`);
}
