"""An invoice StudioCue issues for a studio that bills a job itself.

Every word and figure arrives decided and formatted
(features/billing/studio-invoice-document.ts): the lines, the tax, the
payments received and the balance. This only lays them out, on one US Letter
page for any ordinary invoice: the studio's mark and address, INVOICE with
its number, who it's billed to and for which job, the lines, the totals, and
how to pay.

Nothing here adds anything up. A total printed here that differed from the
portal's would be a second truth about money; the caller's figures are final.
"""

import io
import urllib.request
from html import escape
from io import BytesIO
from typing import Any

from pydantic import BaseModel, Field
from reportlab.lib.colors import HexColor
from reportlab.lib.enums import TA_RIGHT
from reportlab.lib.pagesizes import LETTER
from reportlab.lib.styles import ParagraphStyle
from reportlab.lib.units import inch
from reportlab.platypus import Image, KeepTogether, Paragraph, SimpleDocTemplate, Spacer, Table, TableStyle

INK = HexColor("#1E2A25")
MUTED = HexColor("#67706B")
LINE = HexColor("#D9DDD8")
SOFT = HexColor("#F4F5F2")
ACCENT = HexColor("#A76C45")
PAID = HexColor("#2F6B4F")
VOID = HexColor("#9A3B2E")


class InvoiceStudio(BaseModel):
    name: str = Field(min_length=1, max_length=160)
    address_lines: list[str] = Field(default_factory=list, max_length=6)
    email: str = Field(default="", max_length=200)
    phone: str = Field(default="", max_length=40)
    logo_url: str = Field(default="", max_length=2000)


class InvoiceBillTo(BaseModel):
    name: str = Field(min_length=1, max_length=200)
    email: str = Field(default="", max_length=200)
    address_lines: list[str] = Field(default_factory=list, max_length=6)


class InvoiceLine(BaseModel):
    description: str = Field(min_length=1, max_length=240)
    quantity: str = Field(min_length=1, max_length=12)
    unit_amount: str = Field(min_length=1, max_length=40)
    amount: str = Field(min_length=1, max_length=40)


class InvoiceRow(BaseModel):
    label: str = Field(min_length=1, max_length=120)
    amount: str = Field(min_length=1, max_length=40)


class InvoiceRequest(BaseModel):
    invoice_id: str = Field(min_length=1, max_length=160)
    project_id: str = Field(min_length=1, max_length=160)
    invoice_number: str = Field(min_length=1, max_length=40)
    kind_label: str = Field(min_length=1, max_length=60)
    stamp: str = Field(default="", max_length=10)
    issued_on: str = Field(default="", max_length=60)
    due_on: str = Field(min_length=1, max_length=60)
    studio: InvoiceStudio
    bill_to: InvoiceBillTo
    job_line: str = Field(default="", max_length=300)
    lines: list[InvoiceLine] = Field(min_length=1, max_length=40)
    totals: list[InvoiceRow] = Field(min_length=1, max_length=4)
    payments: list[InvoiceRow] = Field(default_factory=list, max_length=40)
    balance_due: str = Field(min_length=1, max_length=40)
    payment_instructions: str = Field(default="", max_length=1000)
    pay_link: str = Field(default="", max_length=500)
    footer: str = Field(default="", max_length=500)
    generated_at: str = Field(min_length=1, max_length=80)


def _styles() -> dict[str, ParagraphStyle]:
    base = ParagraphStyle(name="Base", fontName="Helvetica", fontSize=9.5, leading=13.5, textColor=MUTED)
    return {
        "brand": ParagraphStyle(name="Brand", parent=base, fontName="Helvetica-Bold", fontSize=13, leading=16, textColor=INK),
        "small": ParagraphStyle(name="Small", parent=base, fontSize=8.5, leading=12),
        "title": ParagraphStyle(name="Title", parent=base, fontName="Times-Roman", fontSize=30, leading=32, textColor=INK, alignment=TA_RIGHT),
        "right": ParagraphStyle(name="Right", parent=base, alignment=TA_RIGHT),
        "label": ParagraphStyle(name="Label", parent=base, fontName="Helvetica-Bold", fontSize=7.5, leading=10, textColor=MUTED),
        "body": ParagraphStyle(name="Body", parent=base, textColor=INK),
        "body_right": ParagraphStyle(name="BodyRight", parent=base, textColor=INK, alignment=TA_RIGHT),
        "head": ParagraphStyle(name="Head", parent=base, fontName="Helvetica-Bold", fontSize=8, leading=10, textColor=MUTED),
        "head_right": ParagraphStyle(name="HeadRight", parent=base, fontName="Helvetica-Bold", fontSize=8, leading=10, textColor=MUTED, alignment=TA_RIGHT),
        "due": ParagraphStyle(name="Due", parent=base, fontName="Helvetica-Bold", fontSize=13, leading=16, textColor=INK, alignment=TA_RIGHT),
    }


def _logo(url: str) -> Any:
    """The studio's mark, trimmed of empty margin; None when it won't load."""
    if not url:
        return None
    try:
        with urllib.request.urlopen(url, timeout=5) as response:
            raw = response.read(2 * 1024 * 1024)
        try:
            from PIL import Image as PILImage

            with PILImage.open(io.BytesIO(raw)) as source:
                image = source.convert("RGBA")
            white = PILImage.new("RGBA", image.size, (255, 255, 255, 255))
            ink = PILImage.alpha_composite(white, image).convert("L").point(lambda value: 255 if value < 235 else 0)
            box = ink.getbbox()
            if box:
                image = image.crop(box)
            image.thumbnail((1200, 1200))
            out = io.BytesIO()
            image.save(out, format="PNG")
            raw = out.getvalue()
        except Exception:
            pass
        logo = Image(io.BytesIO(raw))
        ratio = logo.imageHeight / logo.imageWidth if logo.imageWidth else 1
        logo.drawWidth = min(1.8 * inch, logo.imageWidth)
        logo.drawHeight = logo.drawWidth * ratio
        if logo.drawHeight > 0.6 * inch:
            logo.drawHeight = 0.6 * inch
            logo.drawWidth = logo.drawHeight / ratio if ratio else logo.drawWidth
        logo.hAlign = "LEFT"
        return logo
    except Exception:
        return None


def _lines(values: list[str]) -> str:
    return "<br/>".join(escape(value) for value in values if value)


def build_invoice_pdf(data: InvoiceRequest) -> bytes:
    styles = _styles()
    buffer = BytesIO()
    doc = SimpleDocTemplate(
        buffer,
        pagesize=LETTER,
        leftMargin=0.72 * inch,
        rightMargin=0.72 * inch,
        topMargin=0.62 * inch,
        bottomMargin=0.7 * inch,
        title=f"{data.studio.name} invoice {data.invoice_number}",
        author=data.studio.name,
    )
    # The frame's own 6pt padding each side: a table as wide as doc.width
    # overhangs the text column by that much.
    width = doc.width - 12

    def footer(canvas: Any, document: Any) -> None:
        canvas.saveState()
        canvas.setStrokeColor(LINE)
        canvas.line(doc.leftMargin + 6, 0.5 * inch, LETTER[0] - doc.rightMargin - 6, 0.5 * inch)
        canvas.setFont("Helvetica", 7.5)
        canvas.setFillColor(MUTED)
        canvas.drawString(doc.leftMargin + 6, 0.32 * inch, f"{data.studio.name}  |  Invoice {data.invoice_number}")
        canvas.drawRightString(LETTER[0] - doc.rightMargin - 6, 0.32 * inch, f"Page {document.page}")
        canvas.restoreState()

    # The studio's mark and address on the left; INVOICE and its number on the right.
    studio_lines = [*data.studio.address_lines, data.studio.phone, data.studio.email]
    mark = _logo(data.studio.logo_url)
    left = [mark if mark is not None else Paragraph(escape(data.studio.name), styles["brand"])]
    if mark is not None:
        left.append(Spacer(1, 4))
        left.append(Paragraph(f"<b>{escape(data.studio.name)}</b>", styles["small"]))
    if any(studio_lines):
        left.append(Paragraph(_lines(studio_lines), styles["small"]))
    stamp_color = PAID if data.stamp == "PAID" else VOID
    right = [
        Paragraph("Invoice", styles["title"]),
        Paragraph(f"<b>{escape(data.invoice_number)}</b> &middot; {escape(data.kind_label)}", styles["right"]),
    ]
    if data.stamp:
        right.append(Spacer(1, 4))
        right.append(
            Paragraph(
                f"<font color='{stamp_color.hexval().replace('0x', '#')}'><b>{escape(data.stamp)}</b></font>",
                ParagraphStyle(name="Stamp", parent=styles["right"], fontSize=14, leading=17),
            )
        )
    header = Table([[left, right]], colWidths=[width * 0.55, width * 0.45])
    header.setStyle(
        TableStyle(
            [
                ("VALIGN", (0, 0), (-1, -1), "TOP"),
                ("LEFTPADDING", (0, 0), (-1, -1), 0),
                ("RIGHTPADDING", (0, 0), (-1, -1), 0),
            ]
        )
    )

    # Who it's for, and when.
    bill_to = [
        Paragraph("BILL TO", styles["label"]),
        Paragraph(f"<b>{escape(data.bill_to.name)}</b>", styles["body"]),
    ]
    contact = [*data.bill_to.address_lines, data.bill_to.email]
    if any(contact):
        bill_to.append(Paragraph(_lines(contact), styles["small"]))
    dates_rows = []
    if data.issued_on:
        dates_rows.append(("Invoice date", data.issued_on))
    dates_rows.append(("Due", data.due_on))
    dates = Table(
        [[Paragraph(escape(label), styles["small"]), Paragraph(escape(value), styles["body_right"])] for label, value in dates_rows],
        colWidths=[width * 0.18, width * 0.27],
    )
    dates.setStyle(
        TableStyle(
            [
                ("LEFTPADDING", (0, 0), (-1, -1), 0),
                ("RIGHTPADDING", (0, 0), (-1, -1), 0),
                ("TOPPADDING", (0, 0), (-1, -1), 1),
                ("BOTTOMPADDING", (0, 0), (-1, -1), 1),
            ]
        )
    )
    meta = Table([[bill_to, dates]], colWidths=[width * 0.55, width * 0.45])
    meta.setStyle(
        TableStyle(
            [
                ("VALIGN", (0, 0), (-1, -1), "TOP"),
                ("LEFTPADDING", (0, 0), (-1, -1), 0),
                ("RIGHTPADDING", (0, 0), (-1, -1), 0),
            ]
        )
    )

    # The lines.
    rows = [
        [
            Paragraph("DESCRIPTION", styles["head"]),
            Paragraph("QTY", styles["head_right"]),
            Paragraph("RATE", styles["head_right"]),
            Paragraph("AMOUNT", styles["head_right"]),
        ]
    ]
    for line in data.lines:
        rows.append(
            [
                Paragraph(escape(line.description), styles["body"]),
                Paragraph(escape(line.quantity), styles["body_right"]),
                Paragraph(escape(line.unit_amount), styles["body_right"]),
                Paragraph(escape(line.amount), styles["body_right"]),
            ]
        )
    items = Table(rows, colWidths=[width * 0.55, width * 0.1, width * 0.17, width * 0.18], repeatRows=1)
    items.setStyle(
        TableStyle(
            [
                ("LINEBELOW", (0, 0), (-1, 0), 0.8, INK),
                ("LINEBELOW", (0, 1), (-1, -1), 0.4, LINE),
                ("VALIGN", (0, 0), (-1, -1), "TOP"),
                ("LEFTPADDING", (0, 0), (-1, -1), 0),
                ("RIGHTPADDING", (0, 0), (-1, -1), 0),
                ("TOPPADDING", (0, 0), (-1, -1), 6),
                ("BOTTOMPADDING", (0, 0), (-1, -1), 6),
            ]
        )
    )

    # Totals, payments received, and what's left to pay.
    total_rows = [[Paragraph(escape(row.label), styles["small"]), Paragraph(escape(row.amount), styles["body_right"])] for row in data.totals]
    total_rows += [[Paragraph(escape(row.label), styles["small"]), Paragraph(escape(row.amount), styles["body_right"])] for row in data.payments]
    total_rows.append([Paragraph("<b>Balance due</b>", styles["body"]), Paragraph(escape(data.balance_due), styles["due"])])
    totals = Table(total_rows, colWidths=[width * 0.27, width * 0.18], hAlign="RIGHT")
    last = len(total_rows) - 1
    totals.setStyle(
        TableStyle(
            [
                ("LEFTPADDING", (0, 0), (-1, -1), 0),
                ("RIGHTPADDING", (0, 0), (-1, -1), 0),
                ("TOPPADDING", (0, 0), (-1, -1), 3),
                ("BOTTOMPADDING", (0, 0), (-1, -1), 3),
                ("LINEABOVE", (0, last), (-1, last), 0.8, INK),
                ("TOPPADDING", (0, last), (-1, last), 7),
                ("VALIGN", (0, 0), (-1, -1), "MIDDLE"),
            ]
        )
    )

    story: list[Any] = [header, Spacer(1, 0.32 * inch), meta]
    if data.job_line:
        story += [Spacer(1, 0.18 * inch), Paragraph(f"<b>For</b>&nbsp;&nbsp;{escape(data.job_line)}", styles["body"])]
    story += [Spacer(1, 0.22 * inch), items, Spacer(1, 0.14 * inch), totals]

    # How to pay: the studio's own words, and its link when it has one.
    pay: list[Any] = []
    if data.payment_instructions:
        pay.append(Paragraph(escape(data.payment_instructions).replace("\n", "<br/>"), styles["body"]))
    if data.pay_link:
        link = escape(data.pay_link)
        pay.append(Paragraph(f"Pay online: <link href='{link}' color='#A76C45'><u>{link}</u></link>", styles["body"]))
    if pay:
        box = Table([[[Paragraph("HOW TO PAY", styles["label"]), Spacer(1, 3), *pay]]], colWidths=[width])
        box.setStyle(
            TableStyle(
                [
                    ("BACKGROUND", (0, 0), (-1, -1), SOFT),
                    ("BOX", (0, 0), (-1, -1), 0.5, LINE),
                    ("LEFTPADDING", (0, 0), (-1, -1), 12),
                    ("RIGHTPADDING", (0, 0), (-1, -1), 12),
                    ("TOPPADDING", (0, 0), (-1, -1), 10),
                    ("BOTTOMPADDING", (0, 0), (-1, -1), 10),
                ]
            )
        )
        story += [Spacer(1, 0.3 * inch), KeepTogether([box])]
    if data.footer:
        story += [Spacer(1, 0.24 * inch), Paragraph(escape(data.footer).replace("\n", "<br/>"), styles["small"])]

    doc.build(story, onFirstPage=footer, onLaterPages=footer)
    return buffer.getvalue()
