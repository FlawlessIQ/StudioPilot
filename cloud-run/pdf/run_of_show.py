"""The run of show a studio hands out, laid out like the one it already uses.

GR Productions' own (2026-10-06): a serif title, the date and places under
it, a box with where everyone gets ready, marries and celebrates and each
team's hours, then "Day at a Glance" — time, event (with P1 / V1 chips),
location and notes, with each team's finish in red.

Every string arrives formatted (functions/src/planning/run-of-show-doc.ts),
in the wedding's own timezone. This only lays it out.
"""

from html import escape
from io import BytesIO
from typing import Any

from pydantic import BaseModel, Field
from reportlab.lib.colors import HexColor
from reportlab.lib.pagesizes import LETTER
from reportlab.lib.styles import ParagraphStyle
from reportlab.lib.units import inch
from reportlab.platypus import Paragraph, SimpleDocTemplate, Spacer, Table, TableStyle


class RunOfShowFact(BaseModel):
    label: str = Field(min_length=1, max_length=60)
    value: str = Field(max_length=600)


class RunOfShowRow(BaseModel):
    time: str = Field(max_length=40)
    title: str = Field(min_length=1, max_length=240)
    crew: list[str] = Field(default_factory=list, max_length=12)
    where: str = Field(default="", max_length=700)
    concludes: str = Field(default="", max_length=160)


class RunOfShowDocument(BaseModel):
    title: str = Field(min_length=1, max_length=120)
    subtitle: str = Field(default="", max_length=300)
    studio: str = Field(default="", max_length=160)
    facts: list[RunOfShowFact] = Field(default_factory=list, max_length=10)
    rows: list[RunOfShowRow] = Field(min_length=1, max_length=250)
    footer: str = Field(default="", max_length=240)


INK = HexColor("#1F1F1F")
MUTED = HexColor("#5E5E5E")
GOLD = HexColor("#7A5C1E")
RULE = HexColor("#B58A4C")
LINE = HexColor("#E3DACB")
BOX = HexColor("#FAF6EE")
BOX_EDGE = HexColor("#E4D4B4")
RED = "#B03A2E"

# P1 green, V1 sand, P2 blue, V2 rose — then round again. A DJ's, makeup
# artist's and hair stylist's crew (features/schedules/crew-labels.ts) have
# their own pairs, so D1/D2, M1/M2 and H1/H2 never print in the grey fallback.
CHIP_COLORS = {
    ("P", 1): ("#E4EFE2", "#3E6A3B"),
    ("V", 1): ("#F4EAD6", "#87672A"),
    ("P", 2): ("#E1EAF4", "#3A5878"),
    ("V", 2): ("#F3E2EA", "#7A3B5A"),
    ("D", 1): ("#E6E6F6", "#454A9A"),
    ("D", 2): ("#DFF0EE", "#2F6B66"),
    ("M", 1): ("#F7E3EC", "#9A3560"),
    ("M", 2): ("#F8E8DC", "#8F4F24"),
    ("H", 1): ("#EFE4F3", "#6A3F7E"),
    ("H", 2): ("#EBEED9", "#5B6524"),
}


def chip(label: str) -> str:
    trade = label[:1]
    try:
        number = int(label[1:])
    except ValueError:
        number = 1
    background, color = CHIP_COLORS.get((trade, (number - 1) % 2 + 1), ("#EEEEEE", "#444444"))
    return f'<font backColor="{background}" color="{color}" name="Helvetica-Bold" size="8">&nbsp;{escape(label)}&nbsp;</font>'


def build_run_of_show_pdf(document: RunOfShowDocument) -> bytes:
    buffer = BytesIO()
    studio = ParagraphStyle(name="RosStudio", fontName="Helvetica", fontSize=8, leading=10, textColor=MUTED)
    title = ParagraphStyle(name="RosTitle", fontName="Times-Bold", fontSize=25, leading=29, textColor=INK)
    subtitle = ParagraphStyle(name="RosSubtitle", fontName="Helvetica", fontSize=10.5, leading=14, textColor=MUTED)
    fact_label = ParagraphStyle(name="RosFactLabel", fontName="Helvetica-Bold", fontSize=10, leading=13, textColor=GOLD)
    fact_value = ParagraphStyle(name="RosFactValue", fontName="Helvetica", fontSize=10, leading=13, textColor=INK)
    section = ParagraphStyle(name="RosSection", fontName="Times-Bold", fontSize=15, leading=19, textColor=INK)
    head = ParagraphStyle(name="RosHead", fontName="Helvetica-Bold", fontSize=8, leading=10, textColor=GOLD)
    time = ParagraphStyle(name="RosTime", fontName="Helvetica-Bold", fontSize=9.5, leading=13, textColor=INK)
    cell = ParagraphStyle(name="RosCell", fontName="Helvetica", fontSize=9.5, leading=13, textColor=INK)

    doc = SimpleDocTemplate(
        buffer,
        pagesize=LETTER,
        leftMargin=0.6 * inch,
        rightMargin=0.6 * inch,
        topMargin=0.55 * inch,
        bottomMargin=0.6 * inch,
        title=document.title,
        author=document.studio or "StudioCue",
    )
    width = LETTER[0] - doc.leftMargin - doc.rightMargin

    def footer(canvas: Any, page: Any) -> None:
        canvas.saveState()
        canvas.setStrokeColor(LINE)
        canvas.line(doc.leftMargin, 0.45 * inch, LETTER[0] - doc.rightMargin, 0.45 * inch)
        canvas.setFont("Helvetica", 7)
        canvas.setFillColor(MUTED)
        canvas.drawString(doc.leftMargin, 0.28 * inch, document.footer)
        canvas.drawRightString(LETTER[0] - doc.rightMargin, 0.28 * inch, f"Page {page.page}")
        canvas.restoreState()

    story: list[Any] = []
    if document.studio:
        story += [Paragraph(escape(document.studio.upper()), studio), Spacer(1, 0.08 * inch)]
    story.append(Paragraph(escape(document.title), title))
    if document.subtitle:
        story += [Spacer(1, 0.04 * inch), Paragraph(escape(document.subtitle), subtitle)]
    story.append(Spacer(1, 0.24 * inch))

    if document.facts:
        facts = Table(
            [[Paragraph(escape(fact.label), fact_label), Paragraph(escape(fact.value), fact_value)] for fact in document.facts],
            colWidths=[1.75 * inch, width - 1.75 * inch],
        )
        facts.setStyle(
            TableStyle([
                ("BACKGROUND", (0, 0), (-1, -1), BOX),
                ("BOX", (0, 0), (-1, -1), 0.8, BOX_EDGE),
                ("VALIGN", (0, 0), (-1, -1), "TOP"),
                ("LEFTPADDING", (0, 0), (-1, -1), 12),
                ("RIGHTPADDING", (0, 0), (-1, -1), 12),
                ("TOPPADDING", (0, 0), (-1, -1), 4),
                ("BOTTOMPADDING", (0, 0), (-1, -1), 4),
                ("TOPPADDING", (0, 0), (-1, 0), 12),
                ("BOTTOMPADDING", (0, -1), (-1, -1), 12),
            ])
        )
        story += [facts, Spacer(1, 0.3 * inch)]

    story += [Paragraph("Day at a Glance", section), Spacer(1, 0.08 * inch)]
    rows: list[list[Any]] = [[Paragraph("TIME", head), Paragraph("EVENT", head), Paragraph("LOCATION / NOTES", head)]]
    for row in document.rows:
        chips = " ".join(chip(label) for label in row.crew)
        event = f"{chips}&nbsp; {escape(row.title)}" if chips else escape(row.title)
        where = escape(row.where)
        if row.concludes:
            where = f'{where} <font color="{RED}" name="Helvetica-Bold">— {escape(row.concludes)}</font>' if where else f'<font color="{RED}" name="Helvetica-Bold">{escape(row.concludes)}</font>'
        rows.append([Paragraph(escape(row.time), time), Paragraph(event, cell), Paragraph(where, cell)])
    table = Table(rows, repeatRows=1, colWidths=[1.55 * inch, 2.95 * inch, width - 4.5 * inch])
    table.setStyle(
        TableStyle([
            ("LINEABOVE", (0, 0), (-1, 0), 1.4, RULE),
            ("LINEBELOW", (0, 0), (-1, 0), 1.4, RULE),
            ("LINEBELOW", (0, 1), (-1, -1), 0.5, LINE),
            ("VALIGN", (0, 0), (-1, -1), "TOP"),
            ("LEFTPADDING", (0, 0), (-1, -1), 0),
            ("RIGHTPADDING", (0, 0), (-1, -1), 10),
            ("TOPPADDING", (0, 0), (-1, -1), 7),
            ("BOTTOMPADDING", (0, 0), (-1, -1), 7),
        ])
    )
    story.append(table)
    doc.build(story, onFirstPage=footer, onLaterPages=footer)
    return buffer.getvalue()
