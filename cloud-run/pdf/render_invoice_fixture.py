import json
from pathlib import Path

from invoice import InvoiceRequest, build_invoice_pdf

payload = json.loads(Path("sample-invoice.json").read_text())
Path("sample-invoice.pdf").write_bytes(build_invoice_pdf(InvoiceRequest(**payload)))
print("wrote sample-invoice.pdf")
