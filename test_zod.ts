import * as z from 'zod';

const addressSchema = z.object({
    street: z.string().min(1, 'Logradouro é obrigatória'),
    number: z.string().min(1, 'Número é obrigatório'),
    neighborhood: z.string().min(1, 'Bairro é obrigatório'),
    reference: z.string().default(''),
    is_default: z.boolean().default(false),
});

type AddressFormValues = z.infer<typeof addressSchema>;

const data: AddressFormValues = {
    street: 'Rua',
    number: '1',
    neighborhood: 'Bairro',
    reference: 'Ref',
    is_default: true
};

console.log('is_default' in data);
console.log(data);
