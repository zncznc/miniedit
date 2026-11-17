// MiniEdit 示例文件 —— 用原版 c99.mac 的规则着色
#include <stdio.h>
#include <stdlib.h>
#include <string.h>

#define MAX_TOKENS 256
#define VERSION "0.4.5"

typedef struct {
    char *text;
    size_t length;
    int line;
} token_t;

static int is_space(int c)
{
    return c == ' ' || c == '\t' || c == '\r';
}

token_t *token_new(const char *text, size_t length, int line)
{
    token_t *t = (token_t *)malloc(sizeof(token_t));
    if (!t) return NULL;

    t->text = strdup(text);
    t->length = length;
    t->line = line;
    return t;
}

/* 把一段源码切成记号；返回实际写入的个数 */
int tokenize(const char *source, token_t **out, int capacity)
{
    int count = 0;
    int line = 1;
    size_t i = 0;

    while (source[i] != '\0' && count < capacity) {
        if (source[i] == '\n') { line++; i++; continue; }
        if (is_space(source[i])) { i++; continue; }

        size_t start = i;
        while (source[i] != '\0' && !is_space(source[i]) && source[i] != '\n')
            i++;

        out[count++] = token_new(source + start, i - start, line);
        if (i - start > 0x40)
            fprintf(stderr, "warning: long token at line %d\n", line);
    }

    return count;
}

int main(int argc, char **argv)
{
    if (argc < 2) {
        printf("usage: %s <file>\n", argv[0]);
        return 1;
    }

    token_t *tokens[MAX_TOKENS] = { 0 };
    int n = tokenize(argv[1], tokens, MAX_TOKENS);

    for (int k = 0; k < n; k++)
        printf("%3d  %-12zu %s\n", tokens[k]->line, tokens[k]->length, tokens[k]->text);

    return n > 0 ? 0 : -1;
}
