"""Check standalone rubric structure without network or browser access."""
from html.parser import HTMLParser
from pathlib import Path


class Rubric(HTMLParser):
    def __init__(self):
        super().__init__(convert_charrefs=True)
        self.ids = []
        self.links = []
        self.criteria = 0
        self.scale_lengths = []
        self.in_scale = False
        self.scale_length = 0
        self.disclosures = 0
        self.summaries = 0

    def handle_starttag(self, tag, attributes):
        attrs = dict(attributes)
        if "id" in attrs:
            self.ids.append(attrs["id"])
        if tag == "a":
            self.links.append(attrs["href"])
        assert tag not in {"script", "iframe", "form", "img", "link"}, tag
        assert not any(key.startswith("on") for key in attrs), attrs
        if tag == "article" and attrs.get("class") == "criterion":
            self.criteria += 1
        if tag == "ol" and attrs.get("class") == "anchors":
            self.in_scale = True
            self.scale_length = 0
        if tag == "li" and self.in_scale:
            self.scale_length += 1
        if tag == "details":
            self.disclosures += 1
        if tag == "summary":
            self.summaries += 1

    def handle_endtag(self, tag):
        if tag == "ol" and self.in_scale:
            self.scale_lengths.append(self.scale_length)
            self.in_scale = False


path = Path(__file__).resolve().parents[1] / "human-rubric.html"
source = path.read_text()
page = Rubric()
page.feed(source)
assert len(page.ids) == len(set(page.ids)), "Duplicate IDs"
assert all(link.startswith("#") and link[1:] in page.ids for link in page.links)
assert page.criteria == 4
assert page.scale_lengths == [5, 5]
assert page.disclosures == page.summaries == 0
assert 'lang="en"' in source and 'name="viewport"' in source
assert "@media print" in source and "max-width:600px" in source
assert "Requiro — Human Evaluation Rubric" in source
assert "The review schedule is planned; reviewers have not yet scored a shared sample" in source
assert "default-src 'none'" in source
print("PASS: 4 criteria; 2 fully anchored scales; valid internal links; no external assets, scripts or forms.")
