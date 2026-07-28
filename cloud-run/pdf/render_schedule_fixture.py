import json
from pathlib import Path
from reportlab.lib.colors import HexColor
from reportlab.lib.pagesizes import LETTER
from reportlab.lib.styles import getSampleStyleSheet
from reportlab.lib.units import inch
from reportlab.platypus import Paragraph, SimpleDocTemplate, Spacer, Table, TableStyle

root = Path(__file__).resolve().parents[2]
data = json.loads((Path(__file__).parent / "sample-schedule.json").read_text())
output = root / "output" / "pdf" / "studiohub-sample-schedule.pdf"
styles = getSampleStyleSheet()
doc = SimpleDocTemplate(str(output), pagesize=LETTER, leftMargin=.65*inch, rightMargin=.65*inch, topMargin=.55*inch, bottomMargin=.55*inch, title=f"{data['project']} Run of Show v{data['version']}", author="StudioCue")
ink, muted, line, soft = HexColor("#1E2A25"), HexColor("#68716C"), HexColor("#D9DDD8"), HexColor("#F1F3EF")
story = [Paragraph("ALDER & MUSE PHOTOGRAPHY", styles["Heading4"]), Paragraph("EVENT RUN OF SHOW", styles["Normal"]), Spacer(1,.35*inch), Paragraph(data["project"], styles["Title"]), Paragraph(f"{data['event_date']} | {data['timezone']} | Version {data['version']}", styles["Normal"]), Spacer(1,.3*inch)]
rows = [["TIME", "EVENT", "LOCATION", "CREW"]]
rows += [[f"{i['start']} - {i['end']}", i["title"], i["location"], i["crew"]] for i in data["items"]]
table = Table(rows, colWidths=[1.25*inch,2.25*inch,1.65*inch,1.35*inch], repeatRows=1)
table.setStyle(TableStyle([("BACKGROUND",(0,0),(-1,0),ink),("TEXTCOLOR",(0,0),(-1,0),HexColor("#FFFFFF")),("FONTNAME",(0,0),(-1,0),"Helvetica-Bold"),("FONTSIZE",(0,0),(-1,-1),8),("LEADING",(0,0),(-1,-1),11),("ROWBACKGROUNDS",(0,1),(-1,-1),[HexColor("#FFFFFF"),soft]),("GRID",(0,0),(-1,-1),.4,line),("VALIGN",(0,0),(-1,-1),"TOP"),("TOPPADDING",(0,0),(-1,-1),9),("BOTTOMPADDING",(0,0),(-1,-1),9)]))
story += [table, Spacer(1,.28*inch), Paragraph("Published schedules are immutable. Confirm that you are viewing the current version before event-day use.", styles["BodyText"]), Spacer(1,.15*inch), Paragraph(f"Generated {data['generated_at']} | Project {data['project_id']} | Page 1 of 1", styles["Normal"])]
doc.build(story)
print(output)
