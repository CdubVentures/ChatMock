from chatmock.utils import convert_chat_messages_to_responses_input


def test_convert_payload_preserves_image_url_parts():
    payload = [
        {
            "role": "user",
            "content": [
                {"type": "text", "text": "inspect this image"},
                {"type": "image_url", "image_url": {"url": "https://example.com/test.png"}},
            ],
        }
    ]

    converted = convert_chat_messages_to_responses_input(payload)
    assert len(converted) == 1
    assert converted[0]["type"] == "message"
    assert converted[0]["role"] == "user"
    assert converted[0]["content"][0] == {"type": "input_text", "text": "inspect this image"}
    assert converted[0]["content"][1] == {
        "type": "input_image",
        "image_url": "https://example.com/test.png",
    }
