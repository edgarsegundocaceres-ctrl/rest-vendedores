import { createClient } from 'npm:@supabase/supabase-js@2'

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
}

const json = (body: unknown, status = 200) => new Response(JSON.stringify(body), {
  status,
  headers: { ...corsHeaders, 'Content-Type': 'application/json' },
})

const cleanNullable = (value: unknown) => {
  const text = String(value ?? '').trim()
  return text || null
}

Deno.serve(async (req: Request) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: corsHeaders })
  if (req.method !== 'POST') return json({ error: 'Método no permitido' }, 405)

  const url = Deno.env.get('SUPABASE_URL')
  const anonKey = Deno.env.get('SUPABASE_ANON_KEY')
  const serviceKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')
  const authHeader = req.headers.get('Authorization') || ''

  if (!url || !anonKey || !serviceKey) return json({ error: 'Configuración incompleta' }, 500)

  const userClient = createClient(url, anonKey, {
    global: { headers: { Authorization: authHeader } },
    auth: { persistSession: false },
  })
  const serviceClient = createClient(url, serviceKey, {
    auth: { persistSession: false, autoRefreshToken: false },
  })

  try {
    const token = authHeader.replace(/^Bearer\s+/i, '')
    const { data: authData, error: authError } = await userClient.auth.getUser(token)
    const adminUser = authData.user
    if (authError || !adminUser) return json({ error: 'No autorizado' }, 401)

    const { data: profile, error: profileError } = await serviceClient
      .from('perfiles')
      .select('rol,activo')
      .eq('id', adminUser.id)
      .single()

    if (profileError || !profile || profile.rol !== 'admin' || !profile.activo) {
      return json({ error: 'Solo administradores' }, 403)
    }

    const body = await req.json()
    const applicantId = cleanNullable(body.postulante_id)
    const email = String(body.email || '').trim().toLowerCase()
    const password = String(body.password || '')
    let category = String(body.categoria_inicial || 'junior').trim().toLowerCase()
    if (!['junior', 'pro', 'experto', 'master'].includes(category)) category = 'junior'

    if (!email || password.length < 6) {
      return json({ error: 'Email y contraseña de al menos 6 caracteres son obligatorios' }, 400)
    }

    // Conversión de postulante: reutiliza el vendedor provisional creado al aprobar.
    if (applicantId) {
      const { data: applicant, error: applicantError } = await serviceClient
        .from('postulantes_vendedores')
        .select('id,nombre,apellido,dni,telefono,estado,vendedor_id')
        .eq('id', applicantId)
        .single()

      if (applicantError || !applicant) return json({ error: 'Postulante no encontrado' }, 404)
      if (applicant.estado !== 'aprobado') {
        return json({ error: applicant.estado === 'activo' || applicant.estado === 'suspendido'
          ? 'El postulante ya tiene un acceso configurado'
          : 'Primero debe aprobarse la postulación' }, 409)
      }
      if (!applicant.vendedor_id) return json({ error: 'Falta preparar el vendedor aprobado' }, 409)

      const { data: preparedSeller, error: sellerError } = await serviceClient
        .from('vendedores')
        .select('id,user_id')
        .eq('id', applicant.vendedor_id)
        .single()

      if (sellerError || !preparedSeller) return json({ error: 'Vendedor vinculado no encontrado' }, 409)
      if (preparedSeller.user_id) return json({ error: 'El vendedor ya posee un usuario de acceso' }, 409)

      const fullName = `${applicant.nombre} ${applicant.apellido}`.trim()
      const { data: created, error: createError } = await serviceClient.auth.admin.createUser({
        email,
        password,
        email_confirm: true,
        user_metadata: { nombre: fullName },
      })

      if (createError || !created.user) {
        return json({ error: createError?.message || 'No se pudo crear el usuario' }, 400)
      }

      const userId = created.user.id
      const { data: activation, error: activationError } = await userClient.rpc('activar_postulante_vendedor', {
        p_postulante_id: applicant.id,
        p_usuario_id: userId,
        p_categoria: category,
        p_condiciones_comision: cleanNullable(body.condiciones_comision),
        p_activo: body.activo !== false,
      })

      if (activationError) {
        // Si la respuesta se perdió después del commit, no elimines un usuario que
        // ya quedó correctamente vinculado. La consulta con service role sólo se
        // usa para confirmar este caso de recuperación.
        const [{ data: recoveredSeller }, { data: recoveredApplicant }] = await Promise.all([
          serviceClient.from('vendedores').select('*').eq('id', applicant.vendedor_id).maybeSingle(),
          serviceClient.from('postulantes_vendedores').select('*').eq('id', applicant.id).maybeSingle(),
        ])
        if (recoveredSeller?.user_id === userId && ['activo', 'suspendido'].includes(recoveredApplicant?.estado)) {
          return json({ ok: true, vendedor: recoveredSeller, postulante: recoveredApplicant, recuperado: true })
        }
        await serviceClient.auth.admin.deleteUser(userId)
        return json({ error: activationError.message }, 409)
      }

      return json({
        ok: true,
        vendedor: activation?.vendedor,
        postulante: activation?.postulante,
      })
    }

    // Alta manual histórica: conserva el contrato que ya utiliza Administración.
    const name = String(body.nombre || '').trim()
    if (!name) return json({ error: 'El nombre es obligatorio' }, 400)

    const { data: created, error: createError } = await serviceClient.auth.admin.createUser({
      email,
      password,
      email_confirm: true,
      user_metadata: { nombre: name },
    })

    if (createError || !created.user) {
      return json({ error: createError?.message || 'No se pudo crear el usuario' }, 400)
    }

    const userId = created.user.id
    const { error: profileInsertError } = await serviceClient.from('perfiles').insert({
      id: userId,
      nombre: name,
      rol: 'vendedor',
      activo: true,
    })

    if (profileInsertError) {
      await serviceClient.auth.admin.deleteUser(userId)
      return json({ error: profileInsertError.message }, 400)
    }

    const { data: seller, error: sellerInsertError } = await serviceClient
      .from('vendedores')
      .insert({
        user_id: userId,
        nombre: name,
        dni: cleanNullable(body.dni),
        telefono: cleanNullable(body.telefono),
        categoria_actual: category,
        pro_permanente: category !== 'junior',
        activo: true,
      })
      .select()
      .single()

    if (sellerInsertError) {
      await serviceClient.from('perfiles').delete().eq('id', userId)
      await serviceClient.auth.admin.deleteUser(userId)
      return json({ error: sellerInsertError.message }, 400)
    }

    return json({ ok: true, vendedor: seller })
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Error interno'
    return json({ error: message }, 500)
  }
})
