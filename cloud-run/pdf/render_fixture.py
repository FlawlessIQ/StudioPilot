import json
from pathlib import Path

from main import ProposalRequest, build_proposal_pdf

root = Path(__file__).resolve().parents[2]
fixture = json.loads((Path(__file__).parent / "sample-proposal.json").read_text())
output = root / "output" / "pdf" / "studiohub-sample-proposal.pdf"
output.parent.mkdir(parents=True, exist_ok=True)
output.write_bytes(build_proposal_pdf(ProposalRequest.model_validate(fixture)))
print(output)
