<?php
// 示例：PHP 关键字表来自 syntax/php.kwd（四段不同颜色）
namespace App\Demo;

class Greeter
{
    private array $names = [];

    public function __construct(private string $prefix = 'Hello')
    {
    }

    public function add(string $name): static
    {
        $this->names[] = $name;
        return $this;
    }

    public function greet(): array
    {
        $out = [];
        foreach ($this->names as $i => $name) {
            $out[$i] = sprintf('%s, %s!', $this->prefix, ucfirst($name));
        }
        return $out;
    }
}

$greeter = (new Greeter('Hi'))->add('world')->add('miniedit');

foreach ($greeter->greet() as $line) {
    echo $line, PHP_EOL;
}

/* 关键字 16、内置函数 12、魔术常量 6 */
$info = [
    'file' => __FILE__,
    'line' => __LINE__,
    'has'  => array_key_exists('file', get_defined_vars()) ? 'yes' : 'no',
];

var_dump(count($info), strlen(implode(',', array_keys($info))));
?>
