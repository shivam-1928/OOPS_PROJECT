package itsm.web;

import java.util.Map;

/** Small JSON response encoder. Requests use standard URL-encoded forms. */
final class Json {
    private Json() {}

    static String encode(Object value) {
        if (value == null) return "null";
        if (value instanceof Number || value instanceof Boolean) return value.toString();
        if (value instanceof Map<?, ?> map) {
            StringBuilder result = new StringBuilder("{");
            for (var entry : map.entrySet()) {
                if (result.length() > 1) result.append(',');
                result.append(encode(entry.getKey().toString())).append(':').append(encode(entry.getValue()));
            }
            return result.append('}').toString();
        }
        if (value instanceof Iterable<?> list) {
            StringBuilder result = new StringBuilder("[");
            for (Object item : list) {
                if (result.length() > 1) result.append(',');
                result.append(encode(item));
            }
            return result.append(']').toString();
        }
        StringBuilder result = new StringBuilder("\"");
        for (char c : value.toString().toCharArray()) {
            switch (c) {
                case '"' -> result.append("\\\"");
                case '\\' -> result.append("\\\\");
                case '\n' -> result.append("\\n");
                case '\r' -> result.append("\\r");
                case '\t' -> result.append("\\t");
                default -> {
                    if (c < 32) result.append(String.format("\\u%04x", (int) c));
                    else result.append(c);
                }
            }
        }
        return result.append('"').toString();
    }
}
