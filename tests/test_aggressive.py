from chatmock.aggressive import minify_dom_text, prepare_messages_for_aggressive_mode


def test_minify_dom_removes_script_style_svg_but_preserves_tables():
    raw = """
    <style>.x { color: red; }</style>
    <table><tr><td>Cell</td></tr></table>
    <script>console.log("nope")</script>
    <svg><circle cx="10" cy="10" r="5"></circle></svg>
    """
    cleaned = minify_dom_text(raw)
    assert "<script" not in cleaned.lower()
    assert "<style" not in cleaned.lower()
    assert "<svg" not in cleaned.lower()
    assert "<table>" in cleaned.lower()
    assert "cell" in cleaned.lower()


def test_prepare_messages_minifies_large_text_parts():
    messages = [
        {"role": "user", "content": "<div>" + ("x" * 1200) + "<script>alert(1)</script></div>"},
    ]
    processed = prepare_messages_for_aggressive_mode(messages, large_text_threshold=1000)
    assert isinstance(processed, list)
    assert "<script" not in processed[0]["content"].lower()
