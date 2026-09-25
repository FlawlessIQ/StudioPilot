import json
from pathlib import Path

from contract import ContractRequest, build_contract_pdf

payload = json.loads(Path("sample-contract.json").read_text())
Path("sample-contract.pdf").write_bytes(build_contract_pdf(ContractRequest(**payload)))
print("wrote sample-contract.pdf")
