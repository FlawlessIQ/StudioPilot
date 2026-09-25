"""A signed StudioCue agreement, rendered for the record.

The contract itself is data — a list of blocks resolved from the studio's
agreement and the couple's accepted proposal — and the signature is bound to a
hash of that data, not to this file. This renders it faithfully: the studio's
wording as blocks, both signatures, and a certificate page that says who signed,
when, from where, and which exact text (by hash) they signed.

Nothing here decides anything. The caller has already verified the signatures;
this only draws them.
"""

from html import escape
from io import BytesIO
from typing import Any, Literal

from pydantic import BaseModel, Field
from reportlab.lib.colors import HexColor
from reportlab.lib.pagesizes import LETTER
from reportlab.lib.styles import ParagraphStyle, getSampleStyleSheet
from reportlab.lib.units import inch
from reportlab.platypus import (
    KeepTogether,
    ListFlowable,
    ListItem,
    PageBreak,
    Paragraph,
    SimpleDocTemplate,
    Spacer,
    Table,
    TableStyle,
)


class Inline(BaseModel):
    text: str = Field(max_length=20_000)
    bold: bool | None = None
    field: str | None = Field(default=None, max_length=120)


class ScheduleRow(BaseModel):
    label: str = Field(max_length=200)
    amount: str = Field(max_length=60)
    due: str = Field(max_length=80)


class ListEntry(BaseModel):
    content: list[Inline]


class Block(BaseModel):
    type: Literal["heading", "paragraph", "list", "payment_schedule"]
    level: int | None = None
    content: list[Inline] | None = None
    # Each item wraps its runs: Firestore cannot store an array in an array.
    items: list[ListEntry] | None = None
    rows: list[ScheduleRow] | None = None


class Signature(BaseModel):
    role: Literal["studio", "client"]
    typed_name: str = Field(min_length=1, max_length=160)
    email: str | None = Field(default=None, max_length=320)
    signed_at: str = Field(min_length=1, max_length=80)
    ip_address: str | None = Field(default=None, max_length=80)
    user_agent: str | None = Field(default=None, max_length=500)
    auth_method: str | None = Field(default=None, max_length=80)
    consent_version: str = Field(min_length=1, max_length=80)


class Event(BaseModel):
    at: str = Field(min_length=1, max_length=80)
    description: str = Field(min_length=1, max_length=400)


class ContractRequest(BaseModel):
    tenant_name: str = Field(min_length=1, max_length=160)
    project_id: str = Field(min_length=1, max_length=120)
    contract_id: str = Field(min_length=1, max_length=120)
    title: str = Field(min_length=1, max_length=200)
    blocks: list[Block] = Field(min_length=1, max_length=2_000)
    document_hash: str = Field(pattern=r"^[a-f0-9]{64}$")
    template_version: str = Field(min_length=1, max_length=160)
    signatures: list[Signature] = Field(min_length=1, max_length=6)
    events: list[Event] = Field(default_factory=list, max_length=50)
    generated_at: str = Field(min_length=1, max_length=80)


def _inline_markup(content: list[Inline] | None) -> str:
    """ReportLab paragraph markup for a run of inline text. Everything is escaped."""
    pieces: list[str] = []
    for piece in content or []:
        text = escape(piece.text).replace("\n", "<br/>")
        if piece.bold:
            text = f"<b>{text}</b>"
        pieces.append(text)
    return "".join(pieces) or "&nbsp;"


def build_contract_pdf(data: ContractRequest) -> bytes:
    buffer = BytesIO()
    ink = HexColor("#1E2A25")
    muted = HexColor("#67706B")
    line = HexColor("#D9DDD8")
    soft = HexColor("#F1F3EF")
    accent = HexColor("#A76C45")
    styles = getSampleStyleSheet()
    brand = ParagraphStyle(name="CBrand", parent=styles["Normal"], fontName="Helvetica-Bold", fontSize=9, leading=12, textColor=ink)
    meta = ParagraphStyle(name="CMeta", parent=styles["Normal"], fontName="Helvetica", fontSize=7.5, leading=10, textColor=muted)
    title = ParagraphStyle(name="CTitle", parent=styles["Heading1"], fontName="Times-Roman", fontSize=24, leading=28, textColor=ink, spaceAfter=12)
    h1 = ParagraphStyle(name="CH1", parent=styles["Heading2"], fontName="Times-Roman", fontSize=16, leading=20, textColor=ink, spaceBefore=10, spaceAfter=6)
    h2 = ParagraphStyle(name="CH2", parent=styles["Heading3"], fontName="Helvetica-Bold", fontSize=10, leading=14, textColor=ink, spaceBefore=8, spaceAfter=4)
    body = ParagraphStyle(name="CBody", parent=styles["BodyText"], fontName="Helvetica", fontSize=9.5, leading=14, textColor=ink, spaceAfter=6)
    small = ParagraphStyle(name="CSmall", parent=body, fontSize=8, leading=11, textColor=muted, spaceAfter=2)
    signature_style = ParagraphStyle(name="CSig", parent=body, fontName="Times-Italic", fontSize=18, leading=22, textColor=ink, spaceAfter=0)
    eyebrow = ParagraphStyle(name="CEyebrow", parent=meta, textColor=accent, spaceAfter=6)

    doc = SimpleDocTemplate(
        buffer,
        pagesize=LETTER,
        rightMargin=0.8 * inch,
        leftMargin=0.8 * inch,
        topMargin=0.7 * inch,
        bottomMargin=0.75 * inch,
        title=f"{data.tenant_name} — {data.title}",
        author=data.tenant_name,
        subject=f"Agreement {data.contract_id} · sha256 {data.document_hash}",
        creator="StudioCue",
    )

    def footer(canvas: Any, document: Any) -> None:
        canvas.saveState()
        canvas.setStrokeColor(line)
        canvas.line(doc.leftMargin, 0.55 * inch, LETTER[0] - doc.rightMargin, 0.55 * inch)
        canvas.setFont("Helvetica", 6.5)
        canvas.setFillColor(muted)
        canvas.drawString(doc.leftMargin, 0.38 * inch, f"Agreement {data.contract_id}  |  Document sha256 {data.document_hash}")
        canvas.drawRightString(LETTER[0] - doc.rightMargin, 0.38 * inch, f"Page {document.page}")
        canvas.restoreState()

    story: list[Any] = [
        Paragraph(escape(data.tenant_name.upper()), brand),
        Spacer(1, 0.18 * inch),
        Paragraph(escape(data.title), title),
    ]

    for block in data.blocks:
        if block.type == "heading":
            story.append(Paragraph(_inline_markup(block.content), h1 if block.level == 1 else h2))
        elif block.type == "paragraph":
            story.append(Paragraph(_inline_markup(block.content), body))
        elif block.type == "list":
            items = [ListItem(Paragraph(_inline_markup(item.content), body), leftIndent=12) for item in block.items or []]
            if items:
                story.append(ListFlowable(items, bulletType="bullet", start="•", leftIndent=14, bulletFontSize=8))
        elif block.type == "payment_schedule":
            rows = [[Paragraph("<b>Payment</b>", body), Paragraph("<b>Amount</b>", body), Paragraph("<b>Due</b>", body)]]
            rows.extend(
                [Paragraph(escape(row.label), body), Paragraph(escape(row.amount), body), Paragraph(escape(row.due), body)]
                for row in block.rows or []
            )
            table = Table(rows, colWidths=[3.0 * inch, 1.5 * inch, 2.4 * inch], repeatRows=1)
            table.setStyle(TableStyle([
                ("BACKGROUND", (0, 0), (-1, 0), soft),
                ("BOX", (0, 0), (-1, -1), 0.5, line),
                ("INNERGRID", (0, 0), (-1, -1), 0.5, line),
                ("VALIGN", (0, 0), (-1, -1), "TOP"),
                ("TOPPADDING", (0, 0), (-1, -1), 5),
                ("BOTTOMPADDING", (0, 0), (-1, -1), 5),
            ]))
            story.extend([Spacer(1, 0.06 * inch), table, Spacer(1, 0.12 * inch)])

    # Signatures, in signing order: the studio signs first, at send.
    ordered = sorted(data.signatures, key=lambda signature: 0 if signature.role == "studio" else 1)
    signature_cells = []
    for signature in ordered:
        who = data.tenant_name if signature.role == "studio" else "Client"
        signature_cells.append([
            Paragraph(escape(who.upper()), eyebrow),
            Paragraph(escape(signature.typed_name), signature_style),
            Paragraph(f"{escape(signature.typed_name)}<br/>Signed electronically {escape(signature.signed_at)}", small),
        ])
    signature_table = Table([signature_cells], colWidths=[(LETTER[0] - 1.6 * inch) / max(1, len(signature_cells))] * len(signature_cells))
    signature_table.setStyle(TableStyle([
        ("LINEABOVE", (0, 0), (-1, 0), 0.7, line),
        ("VALIGN", (0, 0), (-1, -1), "TOP"),
        ("TOPPADDING", (0, 0), (-1, -1), 10),
    ]))
    story.extend([Spacer(1, 0.3 * inch), KeepTogether([Paragraph("Signatures", h1), signature_table])])

    # The certificate: what an evidence request would ask for.
    story.append(PageBreak())
    story.extend([
        Paragraph("CERTIFICATE OF COMPLETION", eyebrow),
        Paragraph("Signing record", title),
        Paragraph(
            "This page records how this agreement was signed. Each signature was made electronically by the named "
            "person, after agreeing to sign electronically, against the exact text identified by the document "
            "fingerprint below. Any change to that text would change the fingerprint.",
            body,
        ),
        Spacer(1, 0.1 * inch),
    ])
    facts = [
        ["Agreement", data.contract_id],
        ["Studio", data.tenant_name],
        ["Document fingerprint (SHA-256)", data.document_hash],
        ["Agreement version", data.template_version],
        ["Record generated", data.generated_at],
    ]
    fact_table = Table([[Paragraph(escape(k), small), Paragraph(escape(v), body)] for k, v in facts], colWidths=[2.0 * inch, 4.9 * inch])
    fact_table.setStyle(TableStyle([("LINEBELOW", (0, 0), (-1, -1), 0.4, line), ("VALIGN", (0, 0), (-1, -1), "TOP")]))
    story.extend([fact_table, Spacer(1, 0.2 * inch), Paragraph("Signers", h1)])
    for signature in ordered:
        rows = [
            ["Name (as typed)", signature.typed_name],
            ["Role", "Studio" if signature.role == "studio" else "Client"],
            ["Email", signature.email or "—"],
            ["Signed", signature.signed_at],
            ["Signed in with", signature.auth_method or "—"],
            ["IP address", signature.ip_address or "—"],
            ["Device", signature.user_agent or "—"],
            ["Electronic signature consent", signature.consent_version],
        ]
        table = Table([[Paragraph(escape(k), small), Paragraph(escape(v), small)] for k, v in rows], colWidths=[2.0 * inch, 4.9 * inch])
        table.setStyle(TableStyle([("LINEBELOW", (0, 0), (-1, -1), 0.3, line), ("VALIGN", (0, 0), (-1, -1), "TOP")]))
        story.extend([KeepTogether([table]), Spacer(1, 0.16 * inch)])
    if data.events:
        story.append(Paragraph("History", h1))
        history = Table(
            [[Paragraph(escape(event.at), small), Paragraph(escape(event.description), small)] for event in data.events],
            colWidths=[2.3 * inch, 4.6 * inch],
        )
        history.setStyle(TableStyle([("LINEBELOW", (0, 0), (-1, -1), 0.3, line), ("VALIGN", (0, 0), (-1, -1), "TOP")]))
        story.append(history)

    doc.build(story, onFirstPage=footer, onLaterPages=footer)
    return buffer.getvalue()
