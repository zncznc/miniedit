// 编码与行尾：从 desktop/encoding.cjs 一比一移植。
// GBK 用 encoding_rs（它就是 WHATWG 的 gb18030 解码器），UTF-16 手工拼 BOM。

pub const ENCODINGS: [&str; 5] = ["utf-8", "utf-8-bom", "gbk", "utf-16le", "utf-16be"];

pub fn label(encoding: &str) -> &'static str {
    match encoding {
        "utf-8" => "UTF-8",
        "utf-8-bom" => "UTF-8 BOM",
        "gbk" => "GBK",
        "utf-16le" => "UTF-16 LE",
        "utf-16be" => "UTF-16 BE",
        "binary" => "二进制",
        _ => "UTF-8",
    }
}

fn looks_binary(buf: &[u8]) -> bool {
    let n = buf.len().min(8192);
    if n == 0 {
        return false;
    }
    let nul = buf[..n].iter().filter(|b| **b == 0).count();
    nul as f64 / n as f64 > 0.02
}

fn decode_utf16(bytes: &[u8], big_endian: bool) -> String {
    let units: Vec<u16> = bytes
        .chunks_exact(2)
        .map(|c| {
            if big_endian {
                u16::from_be_bytes([c[0], c[1]])
            } else {
                u16::from_le_bytes([c[0], c[1]])
            }
        })
        .collect();
    String::from_utf16_lossy(&units)
}

fn encode_utf16(text: &str, big_endian: bool) -> Vec<u8> {
    let mut out = Vec::with_capacity(text.len() * 2);
    for unit in text.encode_utf16() {
        let bytes = if big_endian {
            unit.to_be_bytes()
        } else {
            unit.to_le_bytes()
        };
        out.extend_from_slice(&bytes);
    }
    out
}

pub struct Detected {
    pub encoding: &'static str,
    pub text: String,
    pub binary: bool,
}

pub fn detect(buf: &[u8]) -> Detected {
    if buf.len() >= 3 && buf[0] == 0xef && buf[1] == 0xbb && buf[2] == 0xbf {
        return Detected {
            encoding: "utf-8-bom",
            text: String::from_utf8_lossy(&buf[3..]).into_owned(),
            binary: false,
        };
    }
    if buf.len() >= 2 && buf[0] == 0xff && buf[1] == 0xfe {
        return Detected {
            encoding: "utf-16le",
            text: decode_utf16(&buf[2..], false),
            binary: false,
        };
    }
    if buf.len() >= 2 && buf[0] == 0xfe && buf[1] == 0xff {
        return Detected {
            encoding: "utf-16be",
            text: decode_utf16(&buf[2..], true),
            binary: false,
        };
    }
    if looks_binary(buf) {
        return Detected {
            encoding: "binary",
            text: buf.iter().map(|b| *b as char).collect(),
            binary: true,
        };
    }
    match std::str::from_utf8(buf) {
        Ok(text) => Detected {
            encoding: "utf-8",
            text: text.to_string(),
            binary: false,
        },
        Err(_) => {
            let (text, _, _) = encoding_rs::GBK.decode(buf);
            Detected {
                encoding: "gbk",
                text: text.into_owned(),
                binary: false,
            }
        }
    }
}

pub fn encode(text: &str, encoding: &str) -> Vec<u8> {
    match encoding {
        "utf-8-bom" => {
            let mut out = vec![0xef, 0xbb, 0xbf];
            out.extend_from_slice(text.as_bytes());
            out
        }
        "utf-16le" => {
            let mut out = vec![0xff, 0xfe];
            out.extend_from_slice(&encode_utf16(text, false));
            out
        }
        "utf-16be" => {
            let mut out = vec![0xfe, 0xff];
            out.extend_from_slice(&encode_utf16(text, true));
            out
        }
        "gbk" => {
            let (bytes, _, _) = encoding_rs::GBK.encode(text);
            bytes.into_owned()
        }
        "binary" => text.chars().map(|c| c as u32 as u8).collect(),
        _ => text.as_bytes().to_vec(),
    }
}

/// 写回后再解一遍，和原文比对 —— GBK 装不下的字符会被写成 '?'，必须让用户知道。
pub fn decode_as(buf: &[u8], encoding: &str) -> String {
    match encoding {
        "utf-8-bom" => String::from_utf8_lossy(if buf.len() >= 3 { &buf[3..] } else { buf }).into_owned(),
        "utf-16le" => decode_utf16(if buf.len() >= 2 { &buf[2..] } else { buf }, false),
        "utf-16be" => decode_utf16(if buf.len() >= 2 { &buf[2..] } else { buf }, true),
        "gbk" => {
            let (text, _, _) = encoding_rs::GBK.decode(buf);
            text.into_owned()
        }
        "binary" => buf.iter().map(|b| *b as char).collect(),
        _ => String::from_utf8_lossy(buf).into_owned(),
    }
}

pub fn detect_eol(text: &str) -> &'static str {
    let bytes = text.as_bytes();
    let mut crlf = 0usize;
    let mut lf = 0usize;
    let mut cr = 0usize;
    for (i, b) in bytes.iter().enumerate() {
        match b {
            b'\r' => {
                if bytes.get(i + 1) == Some(&b'\n') {
                    crlf += 1;
                } else {
                    cr += 1;
                }
            }
            b'\n' => {
                if i == 0 || bytes[i - 1] != b'\r' {
                    lf += 1;
                }
            }
            _ => {}
        }
    }
    if crlf >= lf && crlf >= cr && crlf > 0 {
        "CRLF"
    } else if cr > lf && cr > 0 {
        "CR"
    } else {
        "LF"
    }
}

pub fn normalize_eol(text: &str, eol: &str) -> String {
    let unified = text.replace("\r\n", "\n").replace('\r', "\n");
    match eol {
        "CRLF" => unified.replace('\n', "\r\n"),
        "CR" => unified.replace('\n', "\r"),
        _ => unified,
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn gbk_roundtrip() {
        let text = "第一行：中文测试\r\nsecond line\r\n";
        let bytes = encode(text, "gbk");
        let back = decode_as(&bytes, "gbk");
        assert_eq!(back, text);
        let d = detect(&bytes);
        assert_eq!(d.encoding, "gbk");
        assert_eq!(d.text, text);
        assert_eq!(detect_eol(&d.text), "CRLF");
    }

    #[test]
    fn utf16_roundtrip() {
        for enc in ["utf-16le", "utf-16be"] {
            let text = "中文 abc 😀";
            let bytes = encode(text, enc);
            assert_eq!(decode_as(&bytes, enc), text);
            assert_eq!(detect(&bytes).encoding, enc);
        }
    }

    #[test]
    fn bom_utf8() {
        let bytes = encode("héllo", "utf-8-bom");
        assert_eq!(detect(&bytes).encoding, "utf-8-bom");
        assert_eq!(detect(&bytes).text, "héllo");
    }
}
