"""StudioHub branded PDF service.

Cloud Run receives trusted, validated proposal snapshots. It never reads tenant
or pricing data from the browser and never modifies signed provider documents.
"""

from io import BytesIO
from typing import Any

from fastapi import FastAPI, HTTPException, Response
from pydantic import BaseModel, Field
from reportlab.lib.colors import HexColor
from reportlab.lib.enums import TA_RIGHT
from reportlab.lib.pagesizes import LETTER
from reportlab.lib.styles import ParagraphStyle, getSampleStyleSheet
from reportlab.lib.units import inch
from reportlab.platypus import (
    KeepTogether,
    Paragraph,
    SimpleDocTemplate,
    Spacer,
    Table,
    TableStyle,
)

app = FastAPI(title="StudioHub PDF Service")


class LineItem(BaseModel):
    description: str = Field(min_length=1, max_length=240)
    amount: str = Field(min_length=1, max_length=40)


class ProposalRequest(BaseModel):
    tenant_name: str = Field(min_length=1, max_length=160)
    project_id: str = Field(min_length=1, max_length=120)
    proposal_id: str = Field(min_length=1, max_length=120)
    version: int = Field(ge=1)
    client_name: str = Field(min_length=1, max_length=200)
    event_summary: str = Field(min_length=1, max_length=500)
    package_name: str = Field(min_length=1, max_length=160)
    package_description: str = Field(min_length=1, max_length=2000)
    line_items: list[LineItem] = Field(min_length=1, max_length=50)
    total: str = Field(min_length=1, max_length=40)
    retainer: str = Field(min_length=1, max_length=40)
    balance: str = Field(min_length=1, max_length=40)
    expires_on: str = Field(min_length=1, max_length=80)
    generated_at: str = Field(min_length=1, max_length=80)


class ScheduleItem(BaseModel):
    start: str = Field(min_length=1, max_length=80)
    end: str = Field(min_length=1, max_length=80)
    title: str = Field(min_length=1, max_length=240)
    location: str = Field(max_length=300)


class ScheduleRequest(BaseModel):
    tenant_name: str = Field(min_length=1, max_length=160)
    project_id: str = Field(min_length=1, max_length=120)
    schedule_id: str = Field(min_length=1, max_length=120)
    version: int = Field(ge=1)
    timezone: str = Field(min_length=1, max_length=80)
    items: list[ScheduleItem] = Field(min_length=1, max_length=250)
    generated_at: str = Field(min_length=1, max_length=80)


class CloseoutRequirement(BaseModel):
    label: str = Field(min_length=1, max_length=240)
    complete: bool
    evidence_id: str | None = Field(default=None, max_length=160)


class CloseoutRequest(BaseModel):
    tenant_name: str = Field(min_length=1, max_length=160)
    project_id: str = Field(min_length=1, max_length=120)
    closeout_id: str = Field(min_length=1, max_length=120)
    project_name: str = Field(min_length=1, max_length=200)
    requirements: list[CloseoutRequirement] = Field(min_length=1, max_length=100)
    generated_at: str = Field(min_length=1, max_length=80)


def build_proposal_pdf(data: ProposalRequest) -> bytes:
    buffer = BytesIO()
    ink = HexColor("#1E2A25")
    muted = HexColor("#67706B")
    line = HexColor("#D9DDD8")
    soft = HexColor("#F1F3EF")
    accent = HexColor("#A76C45")
    styles = getSampleStyleSheet()
    styles.add(ParagraphStyle(name="Brand", parent=styles["Normal"], fontName="Helvetica-Bold", fontSize=9, leading=12, textColor=ink, spaceAfter=2))
    styles.add(ParagraphStyle(name="Meta", parent=styles["Normal"], fontName="Helvetica", fontSize=8, leading=11, textColor=muted))
    styles.add(ParagraphStyle(name="Client", parent=styles["Heading1"], fontName="Times-Roman", fontSize=30, leading=34, textColor=ink, spaceAfter=10))
    styles.add(ParagraphStyle(name="Heading", parent=styles["Heading2"], fontName="Times-Roman", fontSize=19, leading=23, textColor=ink, spaceAfter=8))
    styles.add(ParagraphStyle(name="BodyStudio", parent=styles["BodyText"], fontName="Helvetica", fontSize=10, leading=16, textColor=muted))
    styles.add(ParagraphStyle(name="RightMeta", parent=styles["Meta"], alignment=TA_RIGHT))

    doc = SimpleDocTemplate(
        buffer,
        pagesize=LETTER,
        rightMargin=0.72 * inch,
        leftMargin=0.72 * inch,
        topMargin=0.62 * inch,
        bottomMargin=0.62 * inch,
        title=f"{data.tenant_name} Proposal {data.proposal_id}",
        author="StudioHub",
    )

    def footer(canvas: Any, document: Any) -> None:
        canvas.saveState()
        canvas.setStrokeColor(line)
        canvas.line(doc.leftMargin, 0.48 * inch, LETTER[0] - doc.rightMargin, 0.48 * inch)
        canvas.setFont("Helvetica", 7.5)
        canvas.setFillColor(muted)
        canvas.drawString(doc.leftMargin, 0.29 * inch, f"Generated {data.generated_at}  |  Project {data.project_id}")
        canvas.drawRightString(LETTER[0] - doc.rightMargin, 0.29 * inch, f"Page {document.page}")
        canvas.restoreState()

    story = []
    header = Table(
        [
            [
                Paragraph(f"<b>{data.tenant_name.upper()}</b><br/><font color='#67706B'>PHOTOGRAPHY PROPOSAL</font>", styles["Brand"]),
                Paragraph(f"{data.proposal_id}<br/>VERSION {data.version}", styles["RightMeta"]),
            ]
        ],
        colWidths=[4.5 * inch, 2 * inch],
    )
    header.setStyle(TableStyle([("VALIGN", (0, 0), (-1, -1), "TOP"), ("LINEBELOW", (0, 0), (-1, -1), 0.7, line), ("BOTTOMPADDING", (0, 0), (-1, -1), 14)]))
    story.extend([header, Spacer(1, 0.48 * inch), Paragraph("PREPARED FOR", ParagraphStyle(name="Eyebrow", parent=styles["Meta"], textColor=accent, spaceAfter=8)), Paragraph(data.client_name, styles["Client"]), Paragraph(data.event_summary, styles["BodyStudio"]), Spacer(1, 0.5 * inch)])
    story.extend([Paragraph(data.package_name, styles["Heading"]), Paragraph(data.package_description, styles["BodyStudio"]), Spacer(1, 0.28 * inch)])

    rows = [[Paragraph("INVESTMENT", styles["Brand"]), Paragraph("AMOUNT", styles["RightMeta"])]]
    rows.extend([[Paragraph(item.description, styles["BodyStudio"]), Paragraph(item.amount, styles["RightMeta"])] for item in data.line_items])
    rows.append([Paragraph("<b>Total</b>", styles["BodyStudio"]), Paragraph(f"<b>{data.total}</b>", styles["RightMeta"])])
    pricing = Table(rows, colWidths=[5.2 * inch, 1.3 * inch], repeatRows=1)
    pricing.setStyle(TableStyle([
        ("BACKGROUND", (0, 0), (-1, 0), soft),
        ("LINEBELOW", (0, 0), (-1, -1), 0.5, line),
        ("TOPPADDING", (0, 0), (-1, -1), 10),
        ("BOTTOMPADDING", (0, 0), (-1, -1), 10),
        ("LEFTPADDING", (0, 0), (-1, -1), 10),
        ("RIGHTPADDING", (0, 0), (-1, -1), 10),
        ("VALIGN", (0, 0), (-1, -1), "MIDDLE"),
    ]))
    story.extend([pricing, Spacer(1, 0.32 * inch)])
    payments = Table(
        [
            [
                Paragraph(f"<font color='#67706B'>RETAINER ON SIGNING</font><br/><b>{data.retainer}</b>", styles["BodyStudio"]),
                Paragraph(f"<font color='#67706B'>FINAL BALANCE</font><br/><b>{data.balance}</b>", styles["BodyStudio"]),
            ]
        ],
        colWidths=[3.2 * inch, 3.2 * inch],
    )
    payments.setStyle(TableStyle([("BACKGROUND", (0, 0), (-1, -1), soft), ("BOX", (0, 0), (-1, -1), 0.5, line), ("INNERGRID", (0, 0), (-1, -1), 0.5, line), ("TOPPADDING", (0, 0), (-1, -1), 14), ("BOTTOMPADDING", (0, 0), (-1, -1), 14), ("LEFTPADDING", (0, 0), (-1, -1), 12)]))
    story.extend([KeepTogether([Paragraph("Payment schedule", styles["Heading"]), payments]), Spacer(1, 0.3 * inch), Paragraph(f"This proposal expires {data.expires_on}. Final terms are governed by the completed Docusign agreement. Acceptance of this proposal does not itself constitute a signed contract.", styles["BodyStudio"])])
    doc.build(story, onFirstPage=footer, onLaterPages=footer)
    return buffer.getvalue()


def build_operations_pdf(
    *,
    title: str,
    tenant_name: str,
    project_id: str,
    version_label: str,
    generated_at: str,
    rows: list[list[str]],
) -> bytes:
    buffer = BytesIO()
    ink = HexColor("#1E2A25")
    muted = HexColor("#67706B")
    line = HexColor("#D9DDD8")
    soft = HexColor("#F1F3EF")
    styles = getSampleStyleSheet()
    body = ParagraphStyle(name="OpsBody", parent=styles["BodyText"], fontName="Helvetica", fontSize=9, leading=13, textColor=ink)
    meta = ParagraphStyle(name="OpsMeta", parent=body, fontSize=7.5, textColor=muted)
    heading = ParagraphStyle(name="OpsHeading", parent=styles["Heading1"], fontName="Times-Roman", fontSize=28, leading=32, textColor=ink)
    doc = SimpleDocTemplate(buffer, pagesize=LETTER, rightMargin=.55*inch, leftMargin=.55*inch, topMargin=.55*inch, bottomMargin=.62*inch, title=title, author="StudioHub")

    def footer(canvas: Any, document: Any) -> None:
        canvas.saveState()
        canvas.setStrokeColor(line)
        canvas.line(doc.leftMargin, .45*inch, LETTER[0]-doc.rightMargin, .45*inch)
        canvas.setFont("Helvetica", 7)
        canvas.setFillColor(muted)
        canvas.drawString(doc.leftMargin, .27*inch, f"Generated {generated_at}  |  Project {project_id}")
        canvas.drawRightString(LETTER[0]-doc.rightMargin, .27*inch, f"Page {document.page}")
        canvas.restoreState()

    story = [
        Paragraph(tenant_name.upper(), meta),
        Spacer(1, .12*inch),
        Paragraph(title, heading),
        Paragraph(version_label, meta),
        Spacer(1, .32*inch),
    ]
    table_rows = [[Paragraph(cell, body) for cell in row] for row in rows]
    table = Table(table_rows, repeatRows=1, colWidths=[1.1*inch, 1.1*inch, 2.5*inch, 2.2*inch])
    table.setStyle(TableStyle([
        ("BACKGROUND", (0, 0), (-1, 0), soft),
        ("LINEBELOW", (0, 0), (-1, -1), .5, line),
        ("VALIGN", (0, 0), (-1, -1), "TOP"),
        ("TOPPADDING", (0, 0), (-1, -1), 8),
        ("BOTTOMPADDING", (0, 0), (-1, -1), 8),
    ]))
    story.append(table)
    doc.build(story, onFirstPage=footer, onLaterPages=footer)
    return buffer.getvalue()


@app.get("/health")
def health() -> dict[str, str]:
    return {"service": "studiohub-pdf", "status": "ok"}


@app.post("/v1/proposals/pdf")
def proposal_pdf(data: ProposalRequest) -> Response:
    try:
        payload = build_proposal_pdf(data)
    except ValueError as error:
        raise HTTPException(status_code=400, detail=str(error)) from error
    return Response(content=payload, media_type="application/pdf", headers={"Content-Disposition": f'attachment; filename="{data.proposal_id}.pdf"'})


@app.post("/v1/schedules/pdf")
def schedule_pdf(data: ScheduleRequest) -> Response:
    rows = [["START", "END", "ITEM", "LOCATION"]]
    rows.extend([[item.start, item.end, item.title, item.location or "—"] for item in data.items])
    payload = build_operations_pdf(
        title="Run of Show",
        tenant_name=data.tenant_name,
        project_id=data.project_id,
        version_label=f"Schedule {data.schedule_id} · Version {data.version} · {data.timezone}",
        generated_at=data.generated_at,
        rows=rows,
    )
    return Response(content=payload, media_type="application/pdf", headers={"Content-Disposition": f'attachment; filename="{data.schedule_id}.pdf"'})


@app.post("/v1/closeouts/pdf")
def closeout_pdf(data: CloseoutRequest) -> Response:
    rows = [["STATUS", "REQUIREMENT", "EVIDENCE", "PROJECT"]]
    rows.extend([["Complete" if item.complete else "Open", item.label, item.evidence_id or "—", data.project_name] for item in data.requirements])
    payload = build_operations_pdf(
        title="Project Closeout",
        tenant_name=data.tenant_name,
        project_id=data.project_id,
        version_label=f"Closeout {data.closeout_id}",
        generated_at=data.generated_at,
        rows=rows,
    )
    return Response(content=payload, media_type="application/pdf", headers={"Content-Disposition": f'attachment; filename="{data.closeout_id}.pdf"'})
